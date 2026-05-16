/**
 * dedup-utils.js
 * 舆情去重工具函数集（方案A：保守增强）
 */

const fs = require('fs');
const path = require('path');

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return yyyy + '-' + mm + '-' + dd;
}

function normalizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  let n = url.trim().toLowerCase();
  // 去掉 # 锚点
  const hi = n.indexOf('#'); if (hi !== -1) n = n.slice(0, hi);
  // 黑猫投诉的 ?sn=xxx 是唯一标识，保留查询参数
  const isTousu = n.indexOf('tousu.sina.cn') !== -1;
  if (!isTousu) {
    const qi = n.indexOf('?'); if (qi !== -1) n = n.slice(0, qi);
  }
  n = n.replace(/\/+$/, '');
  n = n.replace(/^https?:\/\/www\./, 'https://');
  return n;
}

function loadHistoricalUrlIndex(dataDir, endDateStr, lookbackDays) {
  lookbackDays = lookbackDays || 30;
  var index = new Map();
  var end = new Date(endDateStr);
  for (var i = 1; i <= lookbackDays; i++) {
    var d = new Date(end); d.setDate(d.getDate() - i);
    var ds = formatDate(d);
    var filePath = path.join(dataDir, ds + '.json');
    if (!fs.existsSync(filePath)) continue;
    try {
      var data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      var recs = data.records || [];
      for (var j = 0; j < recs.length; j++) {
        var r = recs[j];
        if (r.url && r.url.trim()) {
          var normUrl = normalizeUrl(r.url);
          if (normUrl && !index.has(normUrl)) {
            index.set(normUrl, { file: ds + '.json', id: r.id, date: r.date || ds, record: r });
          }
        }
      }
    } catch (e) {}
  }
  return index;
}

function cleanTitle(title) {
  if (!title || typeof title !== 'string') return '';
  return title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '').trim();
}

function buildTitleIndex(records) {
  var index = new Map();
  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var ct = cleanTitle(r.title || '');
    if (ct.length >= 4 && !index.has(ct)) {
      index.set(ct, r);
    }
  }
  return index;
}

var RISK_ORDER = { high: 3, medium: 2, low: 1 };
var SENTIMENT_ORDER = { negative: 3, neutral: 2, positive: 1 };
var GENERIC_AUTHORS = ['未知', '黑猫投诉', '小红书', '微博', '网易', '搜狐', '腾讯', '新浪'];

function mergeDuplicateRecords(primary, duplicate) {
  var merged = Object.assign({}, primary);
  if (duplicate.fetchTime && (!merged.fetchTime || duplicate.fetchTime > merged.fetchTime)) {
    merged.fetchTime = duplicate.fetchTime;
  }
  var s1 = (merged.source || '').trim();
  var s2 = (duplicate.source || '').trim();
  if (s2 && s2 !== s1 && s1.indexOf(s2) === -1) {
    merged.source = s1 + ' / ' + s2;
  }
  var a1 = (merged.author || '').trim();
  var a2 = (duplicate.author || '').trim();
  var a1IsGeneric = !a1 || GENERIC_AUTHORS.indexOf(a1) !== -1;
  var a2IsGeneric = !a2 || GENERIC_AUTHORS.indexOf(a2) !== -1;
  if (a2 && !a2IsGeneric && a1IsGeneric) merged.author = a2;
  if ((duplicate.content || '').length > (merged.content || '').length) merged.content = duplicate.content;
  var kwSet = new Set();
  (merged.keywords || []).forEach(function(k) { kwSet.add(k); });
  (duplicate.keywords || []).forEach(function(k) { kwSet.add(k); });
  merged.keywords = Array.from(kwSet).slice(0, 5);
  if (!merged.url && duplicate.url) merged.url = duplicate.url;
  if (duplicate.recency === '24h内') merged.recency = '24h内';
  if ((RISK_ORDER[duplicate.riskLevel] || 0) > (RISK_ORDER[merged.riskLevel] || 0)) merged.riskLevel = duplicate.riskLevel;
  if ((SENTIMENT_ORDER[duplicate.sentiment] || 0) > (SENTIMENT_ORDER[merged.sentiment] || 0)) merged.sentiment = duplicate.sentiment;
  return merged;
}

function deduplicateRecords(records, historicalRecords, urlIndex) {
  historicalRecords = historicalRecords || [];
  var result = [];
  var resultUrlMap = new Map();
  var resultTitleMap = new Map();
  var histUrlMap = new Map();
  var histTitleMap = new Map();

  if (urlIndex) {
    var urlEntries = Array.from(urlIndex.entries());
    for (var i = 0; i < urlEntries.length; i++) {
      histUrlMap.set(urlEntries[i][0], urlEntries[i][1].record);
    }
  }
  if (historicalRecords.length > 0) {
    var tidx = buildTitleIndex(historicalRecords);
    var tentries = Array.from(tidx.entries());
    for (var i = 0; i < tentries.length; i++) {
      histTitleMap.set(tentries[i][0], tentries[i][1]);
    }
  }

  for (var i = 0; i < records.length; i++) {
    var r = records[i];
    var merged = null;
    var matchIdx = -1;

    if (r.url && r.url.trim()) {
      var normUrl = normalizeUrl(r.url);
      if (normUrl) {
        if (resultUrlMap.has(normUrl)) {
          matchIdx = resultUrlMap.get(normUrl);
          merged = mergeDuplicateRecords(result[matchIdx], r);
        } else if (histUrlMap.has(normUrl)) {
          merged = mergeDuplicateRecords(histUrlMap.get(normUrl), r);
        }
      }
    }

    if (matchIdx === -1) {
      var ct = cleanTitle(r.title || '');
      if (ct.length >= 4) {
        if (resultTitleMap.has(ct)) {
          matchIdx = resultTitleMap.get(ct);
          merged = mergeDuplicateRecords(result[matchIdx], r);
        } else if (histTitleMap.has(ct)) {
          merged = mergeDuplicateRecords(histTitleMap.get(ct), r);
        }
      }
    }

    if (merged) {
      if (matchIdx !== -1) {
        result[matchIdx] = merged;
      }
      if (r.url && r.url.trim()) {
        var mapIdx = matchIdx !== -1 ? matchIdx : (result.length - 1);
        resultUrlMap.set(normalizeUrl(r.url), mapIdx);
      }
      var ct2 = cleanTitle(r.title || '');
      if (ct2.length >= 4) {
        var mapIdx2 = matchIdx !== -1 ? matchIdx : (result.length - 1);
        resultTitleMap.set(ct2, mapIdx2);
      }
    } else {
      result.push(Object.assign({}, r));
      var newIdx = result.length - 1;
      if (r.url && r.url.trim()) {
        resultUrlMap.set(normalizeUrl(r.url), newIdx);
      }
      var ct3 = cleanTitle(r.title || '');
      if (ct3.length >= 4) {
        resultTitleMap.set(ct3, newIdx);
      }
    }
  }

  return result;
}

module.exports = {
  normalizeUrl,
  loadHistoricalUrlIndex,
  cleanTitle,
  buildTitleIndex,
  mergeDuplicateRecords,
  deduplicateRecords
};
