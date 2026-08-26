#!/usr/bin/env python3
import pymysql, csv, os
OUT='/home/jasme/wf2/tools/mariadb-live/auctions_enrichment.csv'
# chunked extraction to avoid timeout
conn = pymysql.connect(host='161.35.0.209', port=3306, user='john',
    password="U0aeAr1zFt2\\", database='thecollective_inventory', connect_timeout=15,
    cursorclass=pymysql.cursors.SSCursor, read_timeout=600)
cur=conn.cursor()
cur.execute("""
  SELECT id, from_name, from_number, dealer_rating, region, phone_code,
         front_image, comments, is_from_verified_user, is_from_paid_user,
         is_seller_approved, COALESCE(price,NULL), COALESCE(title,''), COALESCE(description,'')
  FROM auctions
""")
rows=0
with open(OUT,'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f)
    w.writerow(['id','from_name','from_number','dealer_rating','region','phone_code','front_image','comments','is_verified','is_paid','is_seller_approved','price','title','description'])
    while True:
        batch=cur.fetchmany(50000)
        if not batch: break
        for r in batch:
            w.writerow([r[0],r[1],r[2],r[3],r[4],r[5],r[6],r[7],r[8],r[9],r[10],r[11],(r[12] or '')[:4000],(r[13] or '')[:4000]])
            rows+=1
        print(f"  {rows} rows so far", flush=True)
conn.close()
print(f"DONE {rows} rows to {OUT} ({os.path.getsize(OUT)/1e6:.1f} MB)")
