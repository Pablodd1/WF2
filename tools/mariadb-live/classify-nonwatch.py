#!/usr/bin/env python3
# Inspect OTHER classification - show sample titles to refine category mapping
import psycopg2
conn=psycopg2.connect(host='157.245.84.14',port=5432,dbname='watchfacts',
    user='wf_power',password='BWBlR0IDQ1r3Y42v1jwA3yCa',sslmode='require',connect_timeout=20)
cur=conn.cursor()
cur.execute("""
SELECT id, category_id, COALESCE(brand_guess,'') FROM (
  SELECT id, category_id, NULL AS brand_guess, title FROM staging.nonwatch_enrichment
) x
""")
# simpler: sample OTHER rows by keyword
import re
def classify_full(txt):
    t=txt.upper()
    if re.search(r'\b(BIRKIN|KELLY|LINDY|PICOTIN|EVELYNE|CONSTANCE|HERMES BOX|KABALUOKA|FOURRE|TOUT SECRET)\b', t): return 'HANDBAG'
    if re.search(r'\b(ROLEX|PATEK|AUDEMARS|RICHARD MILLE|VACHERON|OMEGA|CARTIER|AP |RM\d|JLC|IWC|HUBLOT|BREITLING|PANERAI|TUDOR|PIAGET|TAG HEUER)\b', t): return 'WATCH'
    if re.search(r'\b(HERMES|HERMÈS)\b', t) and re.search(r'\b(SCARF|CARRÉ|TWILLY|BRACELET|NECKLACE|RING|EARRING|WATCH|CHAINE D|FAUCON|CLIC CLAC)\b', t): return 'ACCESSORY'
    if re.search(r'\b(HERMES|HERMÈS)\b', t): return 'HERMES_OTHER'
    return 'OTHER'

cur.execute("SELECT id, COALESCE(title,'')||' '||COALESCE(description,'') FROM staging.nonwatch_enrichment")
rows=cur.fetchall()
from collections import Counter
cnt=Counter(classify_full(t) for _,t in rows)
print("Refined classification:", dict(cnt))
# sample of the big OTHER bucket
others=[t for _,t in rows if classify_full(t)=='OTHER']
print("\n== Sample 'OTHER' titles ==")
for t in others[:20]:
    print("  -", repr(t[:90]))
conn.close()
