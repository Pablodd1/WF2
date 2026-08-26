#!/usr/bin/env python3
# Re-write auctions_enrichment.csv collapsing newlines in text fields
# so Postgres COPY doesn't trip on embedded newlines.
IN='/home/jasme/wf2/tools/mariadb-live/auctions_enrichment.csv'
OUT='/home/jasme/wf2/tools/mariadb-live/auctions_enrichment_clean.csv'
import csv
def clean(v):
    if v is None: return ''
    s=str(v)
    if '\n' in s or '\r' in s:
        s=s.replace('\r',' ').replace('\n',' ').strip()
    return s
with open(IN,newline='',encoding='utf-8') as fin, open(OUT,'w',newline='',encoding='utf-8') as fout:
    r=csv.reader(fin); w=csv.writer(fout)
    header=next(r); w.writerow(header)
    n=0
    for row in r:
        # col 7=comments, 12=title, 13=description -> clean
        row=[clean(c) if i in (7,12,13) else c for i,c in enumerate(row)]
        w.writerow(row)
        n+=1
        if n%200000==0: print(f"  {n} rows", flush=True)
print(f"DONE {n} rows -> {OUT}")
