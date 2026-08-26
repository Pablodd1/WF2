#!/usr/bin/env python3
# Load nonwatch CSV into PG and classify into HANDBAG / OTHER, then insert into staging.listings.
import psycopg2, csv, io, re
CSV='/home/jasme/wf2/tools/mariadb-live/nonwatch_enrichment.csv'
conn=psycopg2.connect(host='157.245.84.14',port=5432,dbname='watchfacts',
    user='wf_power',password='BWBlR0IDQ1r3Y42v1jwA3yCa',sslmode='require',connect_timeout=20)
cur=conn.cursor()
cur.execute("DROP TABLE IF EXISTS staging.nonwatch_enrichment")
cur.execute("""
CREATE TABLE staging.nonwatch_enrichment (
  id text PRIMARY KEY, category_id int, from_name text, from_number text,
  dealer_rating int, region text, front_image text, price numeric,
  title text, description text
)""")
conn.commit()

def clean(v):
    if v is None: return ''
    return ''.join(ch for ch in str(v) if ch not in ('\x00','\x0b','\x0c','\n','\r'))

def text_file():
    with open(CSV,newline='',encoding='utf-8',errors='replace') as f:
        rd=csv.reader(f); header=next(rd)
        wbuf=io.StringIO(); w=csv.writer(wbuf)
        for row in rd:
            w.writerow([clean(c) for c in row])
            yield wbuf.getvalue(); wbuf.seek(0); wbuf.truncate(0)

class StreamReader(io.RawIOBase):
    def __init__(self,it): self.it=it; self.buf=b''
    def readable(self): return True
    def readinto(self,b):
        if not self.buf:
            nxt=next(self.it,None)
            if nxt is None: return 0
            self.buf=nxt.encode('utf-8')
        seg=self.buf[:len(b)]; b[:len(seg)]=seg; self.buf=self.buf[len(seg):]
        return len(seg)

sql="COPY staging.nonwatch_enrichment (id,category_id,from_name,from_number,dealer_rating,region,front_image,price,title,description) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '')"
cur.copy_expert(sql, StreamReader(text_file()))
conn.commit()
cur.execute("SELECT count(*) FROM staging.nonwatch_enrichment")
print("LOADED", cur.fetchone()[0])

# Classify: HANDBAG if Birkin/Kelly/box/bag keyword; else OTHER
cur.execute("""
SELECT id, COALESCE(title,'')||' '||COALESCE(description,'') AS text
FROM staging.nonwatch_enrichment
""")
rows=cur.fetchall()
def classify(txt):
    t=txt.upper()
    if re.search(r'\b(BIRKIN|KELLY|LINDY|PICOTIN|EVELYNE|HERMES BOX|BOX .*HERMES|BERKIN)\b', t):
        return 'HANDBAG'
    return 'OTHER'
classified=[(rid, classify(txt)) for rid,txt in rows]
# create classification map
import psycopg2.extras
print("Classification counts:")
from collections import Counter
cnt=Counter(c for _,c in classified)
print(dict(cnt))
conn.close()
