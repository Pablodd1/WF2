#!/usr/bin/env python3
# Extract NON-WATCH auctions (cat 24, 12, None) from MariaDB -> CSV
import pymysql, csv, os
OUT='/home/jasme/wf2/tools/mariadb-live/nonwatch_enrichment.csv'
conn = pymysql.connect(host='161.35.0.209', port=3306, user='john',
    password="U0aeAr1zFt2\\", database='thecollective_inventory', connect_timeout=15,
    cursorclass=pymysql.cursors.SSCursor, read_timeout=600)
cur=conn.cursor()
cur.execute("""
  SELECT id, category_id, from_name, from_number, dealer_rating, region, front_image,
         COALESCE(price,NULL), COALESCE(title,''), COALESCE(description,'')
  FROM auctions
  WHERE category_id IN (24,12) OR category_id IS NULL
""")
rows=0
with open(OUT,'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f)
    w.writerow(['id','category_id','from_name','from_number','dealer_rating','region','front_image','price','title','description'])
    while True:
        batch=cur.fetchmany(50000)
        if not batch: break
        for r in batch:
            w.writerow([r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],(r[8] or '').replace('\n',' ').replace('\x00','').strip()[:4000],(r[9] or '').replace('\n',' ').replace('\x00','').strip()[:4000]])
            rows+=1
        print(f"  {rows}", flush=True)
conn.close()
print(f"DONE {rows} rows -> {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
