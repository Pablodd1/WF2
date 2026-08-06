import unittest
import urllib.request
import json
import uuid
import hashlib
import os

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qnsafosakvonzgfcsphh.supabase.co")
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2Fmb3Nha3ZvbnpnZmNzcGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMjI3NDEsImV4cCI6MjEwMTU5ODc0MX0.YUxMjnTHtgPsiWiWko3TS1A47Sjk33SuHC2TND0Rxmg"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ANON_KEY

class TestDatabaseAndPostgRESTIntegration(unittest.TestCase):
    def post_rest(self, endpoint, data, schema=None):
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer": "return=representation"
        }
        if schema:
            headers["Accept-Profile"] = schema
            headers["Content-Profile"] = schema
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode('utf-8'),
            headers=headers,
            method='POST'
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def get_rest(self, endpoint, query_params=None, schema=None):
        param_str = f"?{query_params}" if query_params else ""
        url = f"{SUPABASE_URL}/rest/v1/{endpoint}{param_str}"
        headers = {
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}"
        }
        if schema:
            headers["Accept-Profile"] = schema
        req = urllib.request.Request(url, headers=headers, method='GET')
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode('utf-8'))

    def test_01_trading_floor_view_contract(self):
        """Test PostgREST query on public.reviewed_workbook_market_source_v2 with exact UI columns."""
        cols = [
            'id', 'job_id', 'source_file', 'source_row_number', 'source_record_id',
            'posting_date', 'posted_by', 'phone_number', 'contact_publication_approved',
            'raw_message', 'listing_type', 'brand_scope', 'supplied_brand', 'canonical_brand',
            'model', 'catalog_model', 'raw_reference', 'normalized_reference', 'catalog_reference',
            'dial_color', 'catalog_dial', 'condition', 'workbook_price_usd', 'source_price_amount',
            'source_price_text', 'source_currency', 'price_evidence_status', 'confidence',
            'verification_status', 'user_image_url', 'imported_at', 'has_exact_source_image',
            'verified_price_usd', 'has_verified_usd_price', 'has_complete_identity', 'has_supplied_price'
        ]
        res = self.get_rest("reviewed_workbook_market_source_v2", f"select={','.join(cols)}&limit=5")
        self.assertIsInstance(res, list)

    def test_02_price_research_view_contract(self):
        """Test PostgREST query on public.price_research_verified_source with exact UI columns."""
        cols = [
            'id', 'brand', 'model', 'reference', 'normalized_reference', 'dial_color',
            'condition', 'price', 'price_usd', 'price_raw', 'currency', 'box', 'papers',
            'raw_message', 'posted_by', 'seller_name', 'phone_number', 'seller_phone',
            'flags', 'listing_date', 'created_at', 'source', 'year', 'dealer_id',
            'confidence', 'overall_confidence', 'thumbnail_url', 'image_url',
            'display_image_url', 'image_urls', 'has_images', 'listing_type'
        ]
        res = self.get_rest("price_research_verified_source", f"select={','.join(cols)}&limit=5")
        self.assertIsInstance(res, list)

if __name__ == "__main__":
    unittest.main()
