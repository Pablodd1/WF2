#!/usr/bin/env python3
# Load enrichment CSV into PG via psycopg2 copy_from, stripping control chars.
import psycopg2, csv
CSV='/home/jasme/wf2/tools/mariadb-live/auctions_enrichment_clean.csv'
conn=psycopg2.connect(host='157.245.84.14',port=5432,dbname='watchfacts',
    user='wf_power',password='BWBlR0IDQ1r3Y42v1jwA3yCa',sslmode='require',connect_timeout=20)
cur=conn.cursor()
cur.execute('TRUNCATE staging.auctions_enrichment')
conn.commit()

def clean(v):
    if v is None: return ''
    s=str(v)
    # strip NUL and other problematic control chars; newlines already removed upstream
    return ''.join(ch for ch in s if ch not in ('\x00','\x0b','\x0c'))

def row_iter():
    with open(CSV,'r',encoding='utf-8',newline='') as f:
        r=csv.reader(f)
        header=next(r)
        for row in r:
            cleaned=[clean(c) for c in row]
            yield cleaned
    # note: csv.reader may still raise on raw bytes; handle per-file below

# Use copy_expert with a custom stream that yields cleaned CSVs.
# Simplest: re-serialize each cleaned row to a CSV line and pass a file-like.
import io
def text_file():
    with open(CSV,'r',encoding='utf-8',errors='replace',newline='') as f:
        r=csv.reader(f)
        header=next(r)
        wbuf=io.StringIO()
        w=csv.writer(wbuf)
        for row in r:
            w.writerow([clean(c) for c in row])
            yield wbuf.getvalue()
            wbuf.seek(0); wbuf.truncate(0)

class StreamReader(io.RawIOBase):
    def __init__(self, it): self.it=it; self.buf=b''
    def readable(self): return True
    def readinto(self, b):
        try:
            if not self.buf:
                nxt=next(self.it, None)
                if nxt is None: return 0
                self.buf=nxt.encode('utf-8')
            seg=self.buf[:len(b)]
            b[:len(seg)]=seg
            self.buf=self.buf[len(seg):]
            return len(seg)
        except StopIteration: return 0

copy_sql = "COPY staging.auctions_enrichment (id,from_name,from_number,dealer_rating,region,phone_code,front_image,comments,is_verified,is_paid,is_seller_approved,price,title,description) FROM STDIN WITH (FORMAT csv, HEADER false, NULL '')"
stream=StreamReader(text_file())
try:
    cur.copy_expert(copy_sql, stream)
    conn.commit()
    cur.execute('SELECT count(*) FROM staging.auctions_enrichment')
    print(f"LOADED {cur.fetchone()[0]} rows", flush=True)
except Exception as e:
    conn.rollback()
    import traceback; traceback.print_exc()
finally:
    conn.close()
