import re

BRANDS = [
    'Rolex', 'Patek Philippe', 'Audemars Piguet', 'Richard Mille',
    'Vacheron Constantin', 'Omega', 'Cartier', 'Tudor', 'IWC',
    'Hublot', 'Breitling', 'Tag Heuer', 'Panerai', 'Jaeger-LeCoultre'
]

# Common inline separators used in chat lists
EMOJI_SEPARATORS = [
    "\U0001f195", "\u2705", "\u2b50\ufe0f", "\u2b50", "\U0001f525", "\U0001f31f", "\U0001f48e", "\u2022", "-", "/"
]

def split_bundle_listing(raw_text):
    """
    Splits a raw bundle listing into individual watch listings with brand context inheritance.
    Returns: List of dicts, each representing a single watch listing with raw segment text and brand.
    """
    raw_text = str(raw_text).strip()
    if not raw_text:
        return []

    lines = raw_text.split('\n')
    
    # Detect parent brand header context
    parent_brand = detect_brand_header(raw_text)

    # Heuristic 1: If there are line-level emoji markers, split inline blocks
    # e.g., "15551or white... 15550sr... "
    for sep in ["\U0001f195", "\u2705", "\u2b50\ufe0f", "\u2b50", "\U0001f525", "\U0001f31f", "\U0001f48e"]:
        pattern = re.compile(sep)
        matches = list(pattern.finditer(raw_text))
        if len(matches) >= 2:
            # Split by emoji marker
            segments = []
            for i in range(len(matches)):
                start = matches[i].start()
                end = matches[i+1].start() if i+1 < len(matches) else len(raw_text)
                segment = raw_text[start:end].strip()
                # Clean up leading separator
                segment = re.sub(r'^' + sep + r'\s*', '', segment)
                if segment:
                    segments.append(segment)
            
            # Infer brands for each segment, falling back to parent brand
            results = []
            for seg in segments:
                brand = infer_brand(seg) or parent_brand
                results.append({"raw_text": seg, "brand": brand})
            return results

    # Heuristic 2: Line-by-line processing with context inheritance
    results = []
    current_brand = None
    last_ref = None
    
    for line in lines:
        line_clean = line.strip()
        if not line_clean:
            continue
            
        # Detect brand headers (e.g., "Rolex", "Cartier", "PP")
        inferred_brand = detect_brand_header(line_clean)
        if inferred_brand:
            current_brand = inferred_brand
            # If the header contains a watch listing (e.g. "PP 5712/1A"), don't skip it
            if not contains_listing_indicators(line_clean):
                continue
                
        # Detect reference pattern
        ref_match = re.search(r'\b(RM\d{2}-\d{2}|[0-9]{4,6}[A-Z]{0,2}|[0-9]{4,6}/[0-9]{1,4}[A-Z]{0,2})\b', line_clean)
        if ref_match:
            ref_val = ref_match.group(1)
            if ref_val.isdigit() and len(ref_val) == 4 and 1950 <= int(ref_val) <= 2030:
                ref_match = None
        
        # If line has price/year but no reference, inherit last reference (Bundle 4 hierarchical format)
        if not ref_match and last_ref and contains_listing_indicators(line_clean):
            full_listing = f"{current_brand or ''} {last_ref} {line_clean}".strip()
            results.append({"raw_text": full_listing, "brand": current_brand})
            continue

        if ref_match:
            last_ref = ref_match.group(1)
            brand = infer_brand(line_clean) or current_brand
            results.append({"raw_text": line_clean, "brand": brand})
            
    # Fallback to simple line split if no structures identified
    if not results:
        for line in lines:
            if contains_listing_indicators(line):
                brand = infer_brand(line)
                results.append({"raw_text": line.strip(), "brand": brand})
                
    return results

def detect_brand_header(text):
    text_lower = text.lower()
    for b in BRANDS:
        if b.lower() in text_lower:
            return b
    if 'pp' in text_lower or 'patek' in text_lower:
        return 'Patek Philippe'
    if 'ap' in text_lower or 'audemars' in text_lower:
        return 'Audemars Piguet'
    if 'rm' in text_lower or 'richard' in text_lower:
        return 'Richard Mille'
    if 'vc' in text_lower or 'vacheron' in text_lower:
        return 'Vacheron Constantin'
    return None

def infer_brand(text):
    text_lower = text.lower()
    for b in BRANDS:
        if b.lower() in text_lower:
            return b
    if 'pp' in text_lower or 'patek' in text_lower:
        return 'Patek Philippe'
    if 'ap' in text_lower or 'audemars' in text_lower:
        return 'Audemars Piguet'
    if 'rm' in text_lower or 'richard' in text_lower:
        return 'Richard Mille'
    if 'vc' in text_lower or 'vacheron' in text_lower:
        return 'Vacheron Constantin'
    return None

def contains_listing_indicators(text):
    # Year, price multipliers (K/M), or common keywords
    return bool(re.search(r'\b(20[0-2]\d|2030|\d+\s*(k|m|K|M)|hkd|usd|usdt|eur|aed|price|ask|asking)\b', text, re.I))

if __name__ == "__main__":
    test_msg = "🐂🐂🐂PP NEW HK🐂🐂🐂3 ⭐️5980/1400r 4/25 hkd4.5m ⭐️7140r 2/25 hkd475k ⭐️5905/1a 5/25 hkd390k"
    print("Test Bundle Splitting:")
    for item in split_bundle_listing(test_msg):
        print(item)
