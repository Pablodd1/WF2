'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const test=require('node:test');
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260812033000_qnsa_trading_reference_rows.sql'),'utf8');
test('reference feed is single-item, price-first and source-backed',()=>{assert.match(sql,/parent_id IS NULL/);assert.match(sql,/COALESCE\(l\.is_bundle,false\)=false/);assert.match(sql,/suppressed_exact_duplicate/);assert.match(sql,/ORDER BY \(l\.price_normalized > 0\) DESC/);assert.match(sql,/raw_message_versions/);assert.match(sql,/dealer_rating/);assert.match(sql,/text_pattern_ops/)});
