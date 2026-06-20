#!/usr/bin/env python3
"""
Vercel Serverless Function: WatchFacts Extraction API
Deployed at /api/extract — processes raw WhatsApp messages and returns structured JSON.
"""

import json
import sys
import os

# Add the extraction engine to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'extraction_engine'))

from extractor import extract_watch_from_line, normalize_text
from reference_data import BRANDS


def handler(request):
    """
    Vercel serverless handler.
    POST /api/extract
    Body: { "messages": ["raw text line 1", "raw text line 2", ...] }
    Returns: { "listings": [...], "stats": {...} }
    """
    if request.get('method', 'GET') == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            },
            'body': '',
        }

    if request.get('method') != 'POST':
        return {
            'statusCode': 405,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': 'POST required'}),
        }

    try:
        body = json.loads(request.get('body', '{}'))
        messages = body.get('messages', [])
        
        if not messages:
            return {
                'statusCode': 400,
                'headers': {'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'messages array required'}),
            }

        listings = []
        stats = {
            'total_messages': len(messages),
            'extracted': 0,
            'high_confidence': 0,
            'medium_confidence': 0,
            'low_confidence': 0,
            'by_brand': {},
            'with_price': 0,
            'errors': [],
        }

        for msg in messages:
            if not msg or not msg.strip():
                continue
            
            result = extract_watch_from_line(msg, None)
            if result:
                listings.append(result)
                stats['extracted'] += 1

                conf = result['extraction_confidence']['overall']
                if conf >= 0.80:
                    stats['high_confidence'] += 1
                elif conf >= 0.50:
                    stats['medium_confidence'] += 1
                else:
                    stats['low_confidence'] += 1

                brand = result.get('brand', 'Unknown')
                stats['by_brand'][brand] = stats['by_brand'].get(brand, 0) + 1

                if result.get('price_original'):
                    stats['with_price'] += 1

        # Sort by confidence
        listings.sort(key=lambda x: x['extraction_confidence']['overall'], reverse=True)

        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json',
            },
            'body': json.dumps({
                'listings': listings,
                'stats': stats,
                'engine_version': '2.0',
            }, ensure_ascii=False, default=str),
        }

    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({
                'error': str(e),
                'listings': [],
                'stats': {'errors': [str(e)]},
            }),
        }
