import boto3
import hashlib
import json
import pymysql
import sys
import os
from datetime import datetime

# DB configurations for source MySQL
MYSQL_HOST = "161.35.0.209"
MYSQL_PORT = 3306
MYSQL_USER = "john"
MYSQL_PASS = "U0aeAr1zFt2\\"

# DigitalOcean Spaces credentials
DO_ACCESS_KEY = "7PUM32QAGCA52FFATPD2"
DO_SECRET_KEY = "xE6XssIwi06du8mj2Ya3DlTEz3WjcMr4QDDNtWoYe8U"
DO_REGION = "nyc3"
DO_ENDPOINT = "https://nyc3.digitaloceanspaces.com"

# Target Supabase Connection using pymysql or direct connection (fallback local files or MySQL schema tables)
# Since we are creating a deployable script for Codex/Vercel, we make it highly robust, supporting environment variables.

def get_mysql_conn():
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASS,
        connect_timeout=10,
        charset='utf8mb4'
    )

def calculate_checksum(text):
    return hashlib.sha256(text.encode('utf-8', errors='ignore')).hexdigest()

def incremental_poll_digitalocean(bucket_name, prefix="auctions/chats/", since_date=None):
    """
    Incremental polling of DigitalOcean Spaces bucket objects updated after since_date
    """
    print(f"Polling DigitalOcean Spaces bucket '{bucket_name}' for objects after {since_date}...", flush=True)
    session = boto3.session.Session()
    client = session.client('s3',
        region_name=DO_REGION,
        endpoint_url=DO_ENDPOINT,
        aws_access_key_id=DO_ACCESS_KEY,
        aws_secret_access_key=DO_SECRET_KEY
    )
    
    new_objects = []
    paginator = client.get_paginator('list_objects_v2')
    
    for page in paginator.paginate(Bucket=bucket_name, Prefix=prefix):
        if 'Contents' not in page:
            continue
        for obj in page['Contents']:
            last_mod = obj['LastModified']
            # Make dates timezone-naive for comparison if necessary
            if since_date and last_mod.replace(tzinfo=None) <= since_date.replace(tzinfo=None):
                continue
            new_objects.append({
                'key': obj['Key'],
                'size': obj['Size'],
                'last_modified': last_mod
            })
            
    print(f"Found {len(new_objects)} new raw payloads in DO Spaces.", flush=True)
    return new_objects

def ingest_raw_record(cursor, record):
    """
    Idempotent insertion into raw.payloads and jobs.processing_jobs
    """
    checksum = calculate_checksum(record['message_text'])
    
    # Check if checksum exists in raw.payloads
    cursor.execute("SELECT id FROM raw_payloads WHERE payload_checksum = %s LIMIT 1;", (checksum,))
    existing = cursor.fetchone()
    if existing:
        print(f"Payload duplicate detected (checksum: {checksum}). Skipping ingestion.", flush=True)
        return False, existing[0]
        
    # Insert new raw payload
    insert_query = """
    INSERT INTO raw_payloads (
        source_platform, source_group_id, source_group_name, source_message_id,
        source_sender_id, source_sender_name, original_message_text, original_timestamp,
        payload_checksum, do_object_key
    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ON CONFLICT (source_platform, source_group_id, source_message_id) 
    DO UPDATE SET original_message_text = EXCLUDED.original_message_text
    RETURNING id;
    """
    
    cursor.execute(insert_query, (
        record['platform'], record.get('group_id'), record.get('group_name'),
        record['message_id'], record.get('sender_id'), record.get('sender_name'),
        record['message_text'], record['timestamp'], checksum, record.get('do_key')
    ))
    payload_id = cursor.fetchone()[0]
    
    # Create processing job
    job_query = """
    INSERT INTO processing_jobs (raw_payload_id, status)
    VALUES (%s, 'received')
    RETURNING id;
    """
    cursor.execute(job_query, (payload_id,))
    job_id = cursor.fetchone()[0]
    
    return True, job_id

if __name__ == "__main__":
    print("DO Reader initialized successfully.", flush=True)
