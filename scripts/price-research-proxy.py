#!/usr/bin/env python3
"""
MySQL Proxy for WatchFacts Price Research
Runs on WSL host (port 8901). Vercel serverless functions proxy
price research queries through this server to the production DB.
"""
import http.server
import json
import subprocess
import urllib.parse
import sys
import os

MYSQL_HOST = '161.35.0.209'
MYSQL_PORT = '3306'
MYSQL_USER = 'john'
MYSQL_PASS = 'U0aeAr1zFt2\\'

# Cross-rate FX
FX = {'HKD': 7.8, 'USD': 1, 'USDT': 1, 'EUR': 0.92, 'GBP': 0.79, 'CHF': 0.89, 'SGD': 1.35, 'JPY': 150, 'AED': 3.67}

def to_usd(amount, currency):
    if not amount or not currency: return None
    return round(float(amount) / FX.get(currency.upper(), 1))

def mysql_query(query, timeout=15):
    env = {**os.environ, 'MYSQL_PWD': MYSQL_PASS}
    # Use double-quotes for the query to avoid single-quote escaping issues
    esc = query.replace('"', '\\"')
    cmd = f'mysql -h {MYSQL_HOST} -P {MYSQL_PORT} -u {MYSQL_USER} --connect-timeout=5 --quick --batch -e "{esc}"'
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, env=env)
        if result.returncode != 0:
            print(f"MySQL error (rc={result.returncode}): {result.stderr[:200]}", file=sys.stderr)
        return result.stdout
    except Exception as e:
        print(f"MySQL exception: {e}", file=sys.stderr)
        return ""

def parse_tsv(text):
    lines = text.strip().split('\n')
    if len(lines) < 2: return []
    headers = lines[0].split('\t')
    rows = []
    for line in lines[1:]:
        cols = line.split('\t')
        row = {}
        for i, h in enumerate(headers):
            row[h] = cols[i] if i < len(cols) else None
        rows.append(row)
    return rows

def extract_price(text):
    if not text: return None
    import re
    patterns = [
        (re.compile(r'(?:HKD|HK\$|hkd)\s*([\d.,]+)\s*([kKmM])?', re.I), 'HKD'),
        (re.compile(r'\$\s*([\d.,]+)\s*([kKmM])?', re.I), 'USD'),
        (re.compile(r'([\d.,]+)\s*(?:USDT|usdt)\b', re.I), 'USDT'),
        (re.compile(r'([\d.,]+)\s*(?:EUR|eur|€)', re.I), 'EUR'),
        (re.compile(r'([\d.,]+)\s*(?:GBP|gbp|£)', re.I), 'GBP'),
        (re.compile(r'([\d.,]+)\s*(?:AED|aed)', re.I), 'AED'),
    ]
    for pat, cur in patterns:
        m = pat.search(text)
        if m:
            val = float(m.group(1).replace(',', ''))
            suf = (m.group(2) or '').lower()
            if suf == 'm': val *= 1_000_000
            elif suf == 'k': val *= 1_000
            price = round(val)
            return {'price': price, 'currency': cur, 'priceUSD': to_usd(price, cur)}
    return None

class PriceHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        
        if parsed.path != '/price-research':
            self.send_error(404)
            return
        
        ref = params.get('reference', [None])[0]
        if not ref:
            self.send_json({'error': 'reference required'}, 400)
            return
        
        try:
            data = self.get_price_data(ref)
            self.send_json(data, 200)
        except Exception as e:
            self.send_json({'error': str(e), 'success': False}, 500)
    
    def get_price_data(self, ref):
        # 1) Reference info
        brand, model = 'Unknown', 'Unknown'
        r = parse_tsv(mysql_query(
            f"SELECT b.value as brand, m.value as model FROM thecollective_catalogs.references r "
            f"JOIN thecollective_catalogs.models m ON r.model_id=m.id "
            f"JOIN thecollective_catalogs.brands b ON m.brand_id=b.id "
            f"WHERE r.value='{ref}' LIMIT 1"
        ))
        if r: brand, model = r[0].get('brand', 'Unknown'), r[0].get('model', 'Unknown')
        
        # 2) Dial colors
        dial_colors, primary_dial = [], None
        d = parse_tsv(mysql_query(
            f"SELECT valid_colors, primary_color FROM thecollective_inventory.reference_color_catalog "
            f"WHERE normalized_reference='{ref}' LIMIT 1"
        ))
        if d:
            try: dial_colors = json.loads(d[0].get('valid_colors', '[]'))
            except: pass
            primary_dial = d[0].get('primary_color')
        
        # 3) FS count
        fs_count = 0
        f = parse_tsv(mysql_query(
            f"SELECT COUNT(*) as cnt FROM thecollective_inventory.auction_watches WHERE normalized_reference='{ref}'"
        ))
        if f: fs_count = int(f[0].get('cnt', 0))
        
        # 4) Market indicators
        market = {}
        m = parse_tsv(mysql_query(
            f"SELECT * FROM thecollective_inventory.market_reference_indicators_current "
            f"WHERE normalized_reference='{ref}' LIMIT 1"
        ))
        if m: market = m[0]
        
        # 5) Listings
        lr = parse_tsv(mysql_query(
            f"SELECT title, dial_color, year, front_image, created_at "
            f"FROM thecollective_inventory.auction_watches "
            f"WHERE normalized_reference='{ref}' LIMIT 200"
        ))
        
        listings = []
        for row in lr:
            p = extract_price(row.get('title', ''))
            if p and p['priceUSD'] and 100 < p['priceUSD'] < 5000000:
                listings.append({
                    'title': row.get('title', ''),
                    'dial': row.get('dial_color'),
                    'year': row.get('year'),
                    'imageUrl': row.get('front_image'),
                    'price': p['price'],
                    'currency': p['currency'],
                    'priceUSD': p['priceUSD'],
                    'date': row.get('created_at'),
                })
        
        # 6) Stats
        prices = sorted([l['priceUSD'] for l in listings])
        
        # IQR outlier removal
        if len(prices) >= 4:
            q1 = prices[len(prices)//4]
            q3 = prices[3*len(prices)//4]
            iqr_val = q3 - q1
            lo, hi = q1 - 1.5 * iqr_val, q3 + 1.5 * iqr_val
            filtered = [p for p in prices if lo <= p <= hi]
        else:
            filtered = prices
        
        # Dedup
        seen = set()
        unique = []
        for l in listings:
            key = f"{l['priceUSD']}_{(l['title'] or '')[:40]}"
            if key not in seen:
                seen.add(key)
                unique.append(l)
        
        # Monthly chart
        buckets = {}
        for l in unique:
            if l['date']:
                month = l['date'][:7]
                buckets.setdefault(month, []).append(l['priceUSD'])
        
        chart = [
            {
                'month': mth,
                'min': min(vals), 'avg': round(sum(vals)/len(vals)),
                'max': max(vals), 'count': len(vals)
            }
            for mth, vals in sorted(buckets.items())
        ]
        
        stats = None
        if filtered:
            stats = {
                'min': filtered[0],
                'avg': round(sum(filtered)/len(filtered)),
                'max': filtered[-1],
                'count': len(filtered)
            }
        
        drift = None
        if market.get('price_drift_pct'):
            drift = float(market['price_drift_pct'])
        elif len(chart) >= 2:
            drift = round(((chart[-1]['avg'] - chart[0]['avg']) / chart[0]['avg']) * 100, 2)
        
        return {
            'success': True,
            'reference': ref,
            'brand': brand,
            'model': model,
            'dialColors': dial_colors,
            'primaryDial': primary_dial,
            'liquidity': {'fsCount': fs_count},
            'pricing': {
                'current': stats,
                'drift': drift,
                'min': int(market.get('min_fs_price_recent', 0)) if market.get('min_fs_price_recent') else None,
                'avg': int(market.get('avg_fs_price_recent', 0)) if market.get('avg_fs_price_recent') else None,
                'max': int(market.get('max_fs_price_recent', 0)) if market.get('max_fs_price_recent') else None,
            },
            'chart': chart,
            'listings': unique[:50],
            'totalListings': len(unique),
            'outliers': len(prices) - len(filtered),
            'duplicates': len(listings) - len(unique),
        }
    
    def send_json(self, data, status=200):
        body = json.dumps(data).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    
    def log_message(self, format, *args):
        print(f"[proxy] {args[0]}", file=sys.stderr)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8901
    server = http.server.HTTPServer(('0.0.0.0', port), PriceHandler)
    print(f"Price Research Proxy running on port {port}")
    server.serve_forever()
