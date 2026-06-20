#!/usr/bin/env python3
"""
WatchFacts Extraction Pipeline
Processes WhatsApp chat exports → structured watch listing JSON
"""

import re
import json
import sys
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from reference_data import (
    BRANDS, REFERENCE_BRAND_MAP, MATERIAL_SUFFIX, PATEK_MATERIAL,
    N_MONTHS, CONDITION_MAP, COLOR_SLANG, COLLABORATIONS,
)


def normalize_text(text: str) -> str:
    """Remove emoji noise markers, normalize whitespace."""
    # Strip common dealer emoji markers
    noise = r'[\U0001F300-\U0001F9FF\u2600-\u27BF\u2B50\u2702-\u27B0\u24C2-\U0001F251\u200D\uFE0F\u20E3\u2122\u00A9\u00AE\u2122\u2753-\u2764]'
    text = re.sub(noise, ' ', text)
    # Remove WhatsApp formatting
    text = re.sub(r'\*([^*]+)\*', r'\1', text)  # bold
    text = re.sub(r'_([^_]+)_', r'\1', text)      # italic
    text = re.sub(r'~([^~]+)~', r'\1', text)      # strikethrough
    return ' '.join(text.split())


def detect_message_type(text: str) -> str:
    """Classify message: FS (for sale), WTB (want to buy), TRADE, INFO, UNKNOWN."""
    text_lower = text.lower()
    wtb_patterns = [r'\bwtb\b', r'\blooking for\b', r'\blooking\b', r'\bneed\b',
                    r'\bwanted\b', r'\bwanna buy\b', r'\b seeking\b']
    for pat in wtb_patterns:
        if re.search(pat, text_lower):
            return "WTB"
    fs_patterns = [r'\bfs\b', r'\bfor sale\b', r'\[for sale\]', r'\bready stock\b',
                   r'\bready in hk\b', r'\bstock\b', r'\bavailable\b', r'\blisting\b']
    for pat in fs_patterns:
        if re.search(pat, text_lower):
            return "FS"
    if re.search(r'\btrade\b|\bswap\b', text_lower):
        return "TRADE"
    if re.search(r'\bprice\b.*\bon request\b|\bsold\b|\bnot for sale\b', text_lower):
        return "INFO"
    # Default: if price detected, it's FS
    if detect_price(text)[0]:
        return "FS"
    return "UNKNOWN"


def detect_brand(text: str, ref: Optional[str] = None) -> Tuple[Optional[str], float]:
    """Detect brand from text or reference prefix."""
    text_lower = text.lower()

    # Explicit brand mention
    for brand_key, info in BRANDS.items():
        if re.search(r'\b' + re.escape(brand_key) + r'\b', text_lower):
            return info["name"], info["confidence"]

    # Check section headers (dealer format: **Rolex**, AP Stock, PP Stock)
    headers = {
        "rolex": ("Rolex", 0.80), "ap": ("Audemars Piguet", 0.80),
        "pp": ("Patek Philippe", 0.80), "patek": ("Patek Philippe", 0.85),
        "rm": ("Richard Mille", 0.75), "richard mille": ("Richard Mille", 0.90),
        "vc": ("Vacheron Constantin", 0.75), "cartier": ("Cartier", 0.80),
        "tudor": ("Tudor", 0.80), "lange": ("A. Lange & Söhne", 0.80),
    }
    for key, (brand, conf) in headers.items():
        if re.search(r'\*' + re.escape(key) + r'\*', text_lower):
            return brand, conf

    # Reference prefix matching
    if ref:
        clean_ref = ref.upper().strip()
        
        # Richard Mille: refs start with RM or have hyphen (07-01, 11-03)
        if clean_ref.startswith("RM") or re.match(r'^\d{2}-\d{2}', clean_ref):
            return "Richard Mille", 0.85
        
        # AP full-style refs: 5 digits + letters (15720ST, 26420CE) — case insensitive
        if re.match(r'^\d{5}[A-Z]{2}', clean_ref, re.IGNORECASE):
            for prefix in ["15", "26", "77", "67"]:
                if clean_ref.startswith(prefix):
                    return "Audemars Piguet", 0.80
        
        # Strip non-alphanumeric for prefix matching
        short_ref = re.sub(r'[^A-Z0-9]', '', clean_ref)
        
        # Rolex: 5-6 digit refs starting with known prefixes
        rolex_prefixes = ["126", "116", "228", "226", "278", "279", "336", "277", "128", "127", "124", "134", "118"]
        for prefix in rolex_prefixes:
            if short_ref.startswith(prefix):
                return "Rolex", 0.80
        
        # Patek: 4 digits (57xx, 59xx, 51xx, etc)
        if re.match(r'^\d{4}', short_ref):
            for prefix in ["57", "59", "51", "52", "53", "58", "61", "70", "71", "72", "73", "49"]:
                if short_ref.startswith(prefix):
                    return "Patek Philippe", 0.75
        
        # Cartier
        if re.match(r'^(WSPN|WSSA|WGTA|WSTA|HPI|WHSA)', clean_ref.upper()):
            return "Cartier", 0.85
        
        # IWC
        if clean_ref.upper().startswith("IW"):
            return "IWC", 0.80
        
        # Tudor
        if re.match(r'^M\d{2}', clean_ref.upper()):
            return "Tudor", 0.75
        
        # VC
        if re.match(r'^(4000|4300|4500|4520|4600|5500|6000|7700)', short_ref):
            return "Vacheron Constantin", 0.75

    return None, 0.0


def extract_reference(text: str) -> Tuple[Optional[str], float]:
    """Extract watch reference number."""
    text_clean = normalize_text(text)

    # Pattern: RMxx-xx format (Richard Mille)
    rm_match = re.search(r'\b(?:RM)?(\d{2,3}[-]\d{2})\b', text_clean, re.IGNORECASE)
    if rm_match:
        ref = f"RM{rm_match.group(1)}"
        return ref, 0.85

    # Pattern: 4-6 digit ref with possible suffix (.OO.A052CA.01 style or letter suffix)
    # AP full format: 15720ST.OO.A052CA.01
    ap_full = re.search(r'\b(\d{5}(?:[A-Z]{2,4})(?:\.[A-Z]{2}\.[A-Z0-9]{5,6}\.\d{2}))\b', text_clean)
    if ap_full:
        return ap_full.group(1), 0.90

    # Standard reference: 4-6 digits + optional letters/suffix (including sub-variant -XXXX)
    # Filter: NOT preceded by price markers, NOT followed by price markers
    std_refs = re.finditer(r'\b(\d{4,6}[A-Za-z]{0,6}(?:/\d+[A-Za-z]{0,2})?(?:-\d{4})?)\b(?!\s*(?:[kKmM]|hkd|HKD|usdt|USDT|usd|USD))', text_clean)
    
    for match in std_refs:
        ref = match.group(1)
        
        # Skip if preceded by currency marker ($, HKD, USDT)
        before = text_clean[max(0, match.start()-10):match.start()].upper()
        if any(before.endswith(m) for m in ['$', 'HKD', 'USDT', 'USD', '.']):
            continue
        # Filter out pure numbers that look like prices (end in 000/500, or 5-6 digits with no letters)
        if re.match(r'^\d{4,6}$', ref):
            # Check if it looks like a price (divisible by 500,000, 1000 etc)
            num = int(ref)
            if num >= 10000 and (num % 1000 == 0 or num % 500 == 0):
                # Likely a price — check if currency indicators nearby
                context_start = max(0, match.start() - 20)
                context_end = min(len(text_clean), match.end() + 10)
                context = text_clean[context_start:context_end]
                if re.search(r'[Hh][Kk][Dd]|[Uu][Ss][Dd][Tt]|\$|:', context):
                    continue  # Skip — this is a price
        
        # Filter out number + currency code (e.g., 60000HKD, 448000HKD)
        suffix_match = re.match(r'^(\d{4,6})([A-Za-z]{2,6})$', ref)
        if suffix_match:
            suffix = suffix_match.group(2).upper()
            if suffix in ('HKD', 'USDT', 'USD', 'HKDUSD', 'USDTUSD'):
                continue  # Skip — price with currency suffix
        
        # Rolex 5-6 digit format: 126xxx, 116xxx, etc. (allow sub-variant like -0043)
        if re.match(r'^(126|116|228|226|278|279|336|277)[0-9A-Z-]+$', ref, re.IGNORECASE):
            return ref, 0.85
        
        # AP 5-digit + letters: 15510ST, 26240OR (case insensitive)
        if re.match(r'^\d{5}[A-Z]{2,}', ref, re.IGNORECASE):
            return ref, 0.85
        
        # General 4-6 digit with letter mix
        if re.match(r'^\d{4,6}[A-Z/]+', ref, re.IGNORECASE) and len(ref) > 4:
            return ref, 0.80
        
        # Pure 4-digit (Patek style) — only if not price-like AND not a year
        if re.match(r'^\d{4}$', ref) and int(ref) < 9000:
            # Filter out years (2020-2030)
            if 2020 <= int(ref) <= 2030:
                continue
            return ref, 0.60

    return None, 0.0


def extract_year(text: str) -> Tuple[Optional[int], Optional[int], float]:
    """
    Extract year from text. Returns (year, month, confidence).
    Supports: 2020y, 20y, N5/2026, 5/2026, 2020, N5
    """
    text_clean = text.lower()

    # N-month code: N5/2026, N10/25
    n_match = re.search(r'\bn(\d{1,2})\s*/\s*(\d{2,4})\b', text_clean)
    if n_match:
        month = int(n_match.group(1))
        year_str = n_match.group(2)
        year = int(year_str) if len(year_str) == 4 else 2000 + int(year_str)
        if 1 <= month <= 12 and 2000 <= year <= 2030:
            return year, month, 0.90

    # N-code without year: N5 (assume current)
    n_only = re.search(r'\bn(\d{1,2})\b(?!\s*/\s*\d)', text_clean)
    if n_only:
        month = int(n_only.group(1))
        if 1 <= month <= 12:
            return None, month, 0.40

    # Month/Year: 5/2026, 12/2025
    my_match = re.search(r'\b(\d{1,2})\s*/\s*(\d{4})\b', text_clean)
    if my_match:
        month = int(my_match.group(1))
        year = int(my_match.group(2))
        if 1 <= month <= 12 and 2000 <= year <= 2030:
            return year, month, 0.85

    # Year with 'y' suffix: 2020y, 22y
    y_match = re.search(r'\b((?:20)?(\d{2}))y\b', text_clean)
    if y_match:
        year_str = y_match.group(2)
        year = 2000 + int(year_str)
        if 2000 <= year <= 2030:
            confidence = 0.85 if y_match.group(1).startswith('20') else 0.75
            return year, None, confidence

    # Year by itself (must be standalone 2020-2030)
    y_standalone = re.search(r'\b(20[2-3]\d)\b(?!\s*[km])', text_clean)
    if y_standalone:
        year = int(y_standalone.group(1))
        if 2000 <= year <= 2030:
            return year, None, 0.60

    return None, None, 0.0


def detect_price(text: str) -> Tuple[Optional[float], Optional[str], Optional[float], Optional[str], float]:
    """
    Extract price from text. Returns (price, currency, second_price, second_currency, confidence).
    Supports: HKD:660000, $85k, 240k hkd, 1.45M, 890k hkd / 115200usdt
    """
    text_clean = text.lower()
    primary_price = None
    primary_currency = None
    second_price = None
    second_currency = None
    confidence = 0.0

    # Pattern: CURRENCY:AMOUNT (HKD:660000)
    curr_colon = re.findall(r'\b(hkd|usdt|usd)\s*[:=]\s*([\d,]+)\s*[km]?\b', text_clean)
    if curr_colon:
        for curr, amt_str in curr_colon:
            amt = float(amt_str.replace(',', ''))
            if not primary_price:
                primary_price = amt
                primary_currency = curr.upper()
                confidence = 0.90

    # Pattern: CURRENCY-AMOUNT-K no space (HKD930K, USDT180K)
    curr_amt_no_space = re.findall(r'\b(hkd|usdt|usd)\s*([\d,.]+)\s*[kK]\b', text_clean, re.IGNORECASE)
    if curr_amt_no_space:
        for curr, amt_str in curr_amt_no_space:
            if not primary_price:
                amt = float(amt_str.replace(',', '')) * 1000
                primary_price = amt
                primary_currency = curr.upper()
                confidence = 0.90

    # Pattern: AMOUNT CURRENCY (240k hkd, 1.45M hkd, 660000 hkd)
    amt_curr = re.findall(r'\b([\d,.]+)\s*([km])\s*(hkd|usdt|usd|uadt)\b', text_clean)
    if amt_curr:
        for amt_str, suffix, curr in amt_curr:
            amt_str = amt_str.replace(',', '')
            amt = float(amt_str)
            if suffix.lower() == 'k':
                amt *= 1000
            elif suffix.lower() == 'm':
                amt *= 1000000
            if not primary_price:
                primary_price = amt
                primary_currency = curr.upper().replace('UADT', 'USDT')
                confidence = 0.90

    # Pattern: AMOUNTk (240k alone, without explicit currency — usually HKD)
    amt_k = re.findall(r'\b([\d,.]+)\s*[kK]\b(?!\s*(hkd|usdt|usd))', text_clean)
    if amt_k and not primary_price:
        amt_str = amt_k[0]
        if isinstance(amt_str, tuple):
            amt_str = amt_str[0]
        amt = float(amt_str.replace(',', '')) * 1000
        primary_price = amt
        primary_currency = "HKD"  # default for HK chat
        confidence = 0.65

    # Pattern: $AMOUNT (assume HKD unless USD context)
    dollar_match = re.findall(r'\$([\d,.]+)\s*[km]?\b', text_clean)
    if dollar_match and not primary_price:
        amt_str = dollar_match[0].replace(',', '')
        amt = float(amt_str)
        # Check for k/m suffix near the match
        if re.search(r'\$[\d,.]+\s*k\b', text_clean, re.IGNORECASE):
            amt *= 1000
        elif re.search(r'\$[\d,.]+\s*m\b', text_clean, re.IGNORECASE):
            amt *= 1000000
        primary_price = amt
        primary_currency = "USD" if re.search(r'\busd\b|\bunited states\b|usdt', text_clean) else "HKD"
        confidence = 0.60

    # Pattern: AMOUNTm (1.45M, 2.5M)
    amt_m = re.findall(r'\b(\d[\d,.]*)\s*[mM]\b', text_clean)
    if amt_m and not primary_price:
        amt_str = amt_m[0]
        if isinstance(amt_str, tuple):
            amt_str = amt_str[0]
        amt_str = amt_str.strip()
        if amt_str and amt_str != '.':
            try:
                amt = float(amt_str.replace(',', '')) * 1000000
                primary_price = amt
                confidence = 0.60
            except ValueError:
                pass

    # Dual currency: PRIMARY / SECOND
    dual = re.search(r'([\d,.]+[km]?\s*(?:hkd|usdt|usd)?)\s*/\s*([\d,.]+)\s*(usdt|usd)\b', text_clean)
    if dual and primary_price:
        second_amt_str = dual.group(2).replace(',', '')
        second_amt = float(second_amt_str)
        if 'k' in dual.group(2).lower():
            second_amt *= 1000
        second_price = second_amt
        second_currency = dual.group(3).upper()

    return primary_price, primary_currency, second_price, second_currency, confidence


def detect_condition(text: str) -> Tuple[Optional[str], Optional[bool], Optional[bool], Optional[bool], float]:
    """
    Extract condition + box/papers. Returns (condition, papers, box, full_set, confidence).
    """
    text_lower = text.lower()

    # Check for naked / only watch
    if re.search(r'\bnaked\b|\bonly watch\b|\bonly wacth\b|\bonlwn wacth\b', text_lower):
        return "pre-owned", False, False, False, 0.85

    # Full set detection
    full_set_match = re.search(r'\bfull set\b', text_lower)
    full_set_no_box = re.search(r'\bfull set\b.*\bno box\b', text_lower)

    if full_set_no_box:
        papers = True
        box = False
        full_set = False
        confidence = 0.75
    elif full_set_match:
        papers = True
        box = True
        full_set = True
        confidence = 0.85
    else:
        papers = None
        box = None
        full_set = None
        confidence = 0.0

    # Individual box/papers
    if re.search(r'\bno papers\b|\bwithout papers\b', text_lower):
        papers = False
        confidence = max(confidence, 0.70)
    if re.search(r'\bpapers\b|\bcard\b|\bblank card\b|stamped', text_lower) and papers is None:
        papers = True
        confidence = max(confidence, 0.60)
    if re.search(r'\bno box\b|\bwithout box\b', text_lower):
        box = False
        confidence = max(confidence, 0.70)
    if re.search(r'\bbox\b', text_lower) and box is None:
        box = True
        confidence = max(confidence, 0.55)

    # Condition detection
    condition = None
    for key, val in sorted(CONDITION_MAP.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(key) + r'\b', text_lower):
            condition = val
            break

    # Some stickers = like-new
    if re.search(r'\bsome stickers\b|\bstickers\b', text_lower):
        condition = "like-new"

    # NOS = new old stock
    if re.search(r'\bnos\b', text_lower):
        condition = "new-old-stock"

    # BNIB
    if re.search(r'\bbnib\b', text_lower):
        condition = "new"
        if papers is None: papers = True
        if box is None: box = True
        if full_set is None: full_set = True

    # No explicit condition but has N-month code = likely new
    if condition is None and re.search(r'\bn\d{1,2}\s*/\s*\d', text_lower):
        condition = "new"
        confidence = max(confidence, 0.50)

    # No condition but "Used" keyword
    if condition is None and re.search(r'\bused\b|\bpre.owned\b', text_lower):
        condition = "pre-owned"

    return condition, papers, box, full_set, confidence


def detect_dial_color(text: str) -> Tuple[Optional[str], float]:
    """Extract dial color from text using slang decoder."""
    text_lower = text.lower()

    for slang, normalized in sorted(COLOR_SLANG.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(slang) + r'\b', text_lower):
            return normalized, 0.80

    return None, 0.0


def detect_case_material(text: str, ref: Optional[str] = None, brand: Optional[str] = None) -> Tuple[Optional[str], float]:
    """Detect case material from text or reference suffix."""
    text_lower = text.lower()

    # Explicit mentions
    if re.search(r'\bwhite gold\b|\bwg\b', text_lower): return "White Gold", 0.90
    if re.search(r'\brose gold\b|\brg\b', text_lower): return "Rose Gold", 0.90
    if re.search(r'\byellow gold\b|\byg\b', text_lower): return "Yellow Gold", 0.90
    if re.search(r'\bplatinum\b|\bpt\b', text_lower): return "Platinum", 0.90
    if re.search(r'\btitanium\b|\bti\b', text_lower): return "Titanium", 0.85
    if re.search(r'\bceramic\b|\bceramics\b', text_lower): return "Ceramic", 0.85
    if re.search(r'\bcarbon\b|\bntpt\b|\bforged carbon\b', text_lower): return "Carbon/NTPT", 0.80
    if re.search(r'\bfull gold\b', text_lower):
        if re.search(r'\bw[gh]\b', text_lower): return "White Gold", 0.80
        if re.search(r'\b[rR][gG]\b', text_lower): return "Rose Gold", 0.80
        return "Yellow Gold", 0.70
    if re.search(r'\bstainless steel\b|\bsteel\b', text_lower):
        return "Stainless Steel", 0.85

    # Material from reference suffix
    if ref and brand:
        if brand == "Patek Philippe":
            for code, material in PATEK_MATERIAL.items():
                if re.search(r'/' + re.escape(code) + r'\b', ref):
                    return material, 0.75
                if re.search(re.escape(code) + r'$', ref):
                    return material, 0.70
        # AP/RM material suffix
        ref_upper = ref.upper()
        for suffix, material in sorted(MATERIAL_SUFFIX.items(), key=lambda x: -len(x[0])):
            if suffix.upper() in ref_upper and len(suffix) >= 2:
                return material, 0.70

    return None, 0.0


def detect_bracelet_material(text: str, ref: Optional[str] = None) -> Tuple[Optional[str], float]:
    """Detect bracelet/strap material."""
    text_lower = text.lower()

    if re.search(r'\bjubilee\b|\bjub\b', text_lower): return "Steel (Jubilee)", 0.85
    if re.search(r'\boyster\b|\boys\b', text_lower): return "Steel (Oyster)", 0.85
    if re.search(r'\bleather\b', text_lower): return "Leather", 0.85
    if re.search(r'\brubber\b', text_lower): return "Rubber", 0.85
    if re.search(r'\bfull gold\b', text_lower): return "Gold", 0.75

    # From reference: steel watches usually come on steel bracelet
    if ref and re.search(r'ST|st', ref):
        return "Stainless Steel", 0.50

    return None, 0.0


def detect_seller_notes(text: str) -> Optional[str]:
    """Extract seller notes: card retention, negotiation hints, extras."""
    notes = []

    keep_card = re.search(r'\(?keep card\s*(\d+)\s*years?\)?', text, re.IGNORECASE)
    if keep_card:
        notes.append(f"Card held for {keep_card.group(1)} year(s)")

    hold_card = re.search(r'hold\s*card\s*(\d+)\s*(?:month|m)', text, re.IGNORECASE)
    if hold_card:
        notes.append(f"Card held for {hold_card.group(1)} months")

    if re.search(r'\bnegotiable\b|\bobo\b|\bor best offer\b', text, re.IGNORECASE):
        notes.append("Negotiable")

    if re.search(r'\bdouble seal\b', text, re.IGNORECASE):
        notes.append("Double sealed (factory)")

    if re.search(r'\b-1 link\b|\b-2 link\b', text, re.IGNORECASE):
        notes.append("Bracelet sized down")

    if re.search(r'\bpm\b|\bdm\b|\bcontact\b', text, re.IGNORECASE):
        notes.append("Contact dealer directly")

    if re.search(r'\bprice on request\b|\bpor\b|\bpm for price\b', text, re.IGNORECASE):
        notes.append("Price on request")

    extra_case = re.search(r'\bfree\s+(?:ntpt|extra|spare)\s+(?:watch case|case)\b', text, re.IGNORECASE)
    if extra_case:
        notes.append("Includes extra watch case")

    return "; ".join(notes) if notes else None


def detect_collaboration(text: str) -> Optional[str]:
    """Detect collaboration/limited edition names."""
    text_lower = text.lower()
    for collab in COLLABORATIONS:
        if collab in text_lower:
            return collab.title()
    limited_match = re.search(r'\b(\d+)\s*limited\b', text_lower)
    if limited_match:
        return f"Limited Edition ({limited_match.group(1)} pcs)"
    return None


def extract_watch_from_line(line: str, section_brand: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """
    Extract a single watch listing from one line of chat.
    Returns structured dict or None if not a watch listing.
    """
    text = line.strip()
    if not text or len(text) < 8:
        return None

    # Skip system messages
    if re.match(r'^\d+/\d+/\d+.*Messages and calls', text):
        return None
    if re.match(r'^\d+/\d+/\d+.*IMG-', text):  # Image-only messages
        return None

    clean = normalize_text(text)

    # Detect message type
    msg_type = detect_message_type(clean)

    # Extract reference
    ref, ref_conf = extract_reference(clean)
    if not ref:
        return None  # No reference = not a watch listing

    # Detect brand — try ref-based first, then text, then section context as fallback
    brand, brand_conf = detect_brand(clean, ref)
    
    # If no brand from ref, try text alone
    if not brand:
        brand, brand_conf = detect_brand(clean, None)
    
    # If still no brand, try section context
    if not brand and section_brand:
        brand, brand_conf = detect_brand(f"{section_brand} {clean}", ref)

    # Year
    year, month, year_conf = extract_year(clean)

    # Price
    price, currency, price2, curr2, price_conf = detect_price(clean)

    # Condition
    condition, papers, box, full_set, cond_conf = detect_condition(clean)

    # Dial color
    dial, dial_conf = detect_dial_color(clean)

    # Case material
    case_mat, case_conf = detect_case_material(clean, ref, brand)

    # Bracelet
    bracelet, brac_conf = detect_bracelet_material(clean, ref)

    # Seller notes
    notes = detect_seller_notes(clean)

    # Collaboration
    collaboration = detect_collaboration(clean)

    # Model name — try to extract from text if explicitly stated
    model_name = None
    model_patterns = ["aquanaut", "nautilus", "royal oak", "daytona", "submariner",
                      "gmt-master", "datejust", "day-date", "yacht-master", "deepsea",
                      "air-king", "explorer", "sky-dweller", "oyster perpetual",
                      "calatrava", "grand complication", "minute repeater", "world time"]
    for model in model_patterns:
        if model in clean.lower():
            model_name = model.title()
            break

    # Overall confidence
    confidences = [c for c in [brand_conf, ref_conf, year_conf, price_conf]
                   if c > 0]
    overall_conf = sum(confidences) / len(confidences) if confidences else 0.0
    # Penalize missing critical fields
    if not year: overall_conf *= 0.85
    if not price: overall_conf *= 0.80
    if not brand: overall_conf *= 0.75
    overall_conf = round(min(overall_conf, 1.0), 2)

    # Build ambiguities list
    ambiguities = []
    if not brand and ref:
        ambiguities.append(f"Brand not detected from reference {ref}")
    if ref_conf < 0.80:
        ambiguities.append(f"Low reference confidence: {ref}")
    if year_conf < 0.60:
        ambiguities.append("Year ambiguous or missing")
    # Typo detection
    if re.search(r'\buadt\b', clean, re.IGNORECASE):
        ambiguities.append("Detected 'uadt' typo (should be USDT)")
    if re.search(r'\bonlwn wacth\b', clean, re.IGNORECASE):
        ambiguities.append("Detected 'onlwn wacth' typo")
    if re.search(r'\b(\d{4}),000', clean):  # 7030,000 pattern
        ambiguities.append("Possible comma-in-number typo detected")

    # Missing context
    missing = []
    if not brand: missing.append("Brand detection")
    if not year: missing.append("Year information")
    if not price: missing.append("Price information")
    if not condition: missing.append("Condition details")
    if not dial: missing.append("Dial color")
    if model_name is None and ref:
        missing.append(f"Model name for reference {ref}")

    return {
        "brand": brand,
        "reference": ref,
        "model_name": model_name,
        "year": year,
        "manufacture_month": month,
        "price_original": price,
        "currency_original": currency,
        "second_price": price2,
        "second_currency": curr2,
        "condition": condition,
        "dial_color": dial,
        "case_material": case_mat,
        "bracelet_material": bracelet,
        "papers": papers,
        "box": box,
        "full_set": full_set,
        "movement_type": None,
        "case_size_mm": None,
        "seller_notes": notes,
        "collaboration": collaboration,
        "message_type": msg_type,
        "extraction_confidence": {
            "brand": brand_conf,
            "reference": ref_conf,
            "price": price_conf,
            "year": year_conf,
            "overall": overall_conf,
        },
        "what_i_needed_but_didnt_have": missing,
        "errors_or_ambiguities": ambiguities,
        "normalization_notes": None,
        "raw_text": text,
    }
