# WatchFacts Extraction Pipeline
# Processes WhatsApp chat exports → structured watch listings JSON

BRANDS = {
    "rolex": {"name": "Rolex", "confidence": 1.0},
    "patek": {"name": "Patek Philippe", "confidence": 0.95},
    "pp": {"name": "Patek Philippe", "confidence": 0.90},
    "ap": {"name": "Audemars Piguet", "confidence": 0.95},
    "audemars": {"name": "Audemars Piguet", "confidence": 0.95},
    "rm": {"name": "Richard Mille", "confidence": 0.85},
    "richard mille": {"name": "Richard Mille", "confidence": 1.0},
    "richard miller": {"name": "Richard Mille", "confidence": 0.90},
    "cartier": {"name": "Cartier", "confidence": 1.0},
    "omega": {"name": "Omega", "confidence": 1.0},
    "tudor": {"name": "Tudor", "confidence": 1.0},
    "vc": {"name": "Vacheron Constantin", "confidence": 0.85},
    "vacheron": {"name": "Vacheron Constantin", "confidence": 1.0},
    "lange": {"name": "A. Lange & Söhne", "confidence": 0.95},
    "a. lange": {"name": "A. Lange & Söhne", "confidence": 1.0},
    "hublot": {"name": "Hublot", "confidence": 1.0},
    "iwc": {"name": "IWC", "confidence": 0.90},
    "breitling": {"name": "Breitling", "confidence": 1.0},
    "jaeger": {"name": "Jaeger-LeCoultre", "confidence": 0.95},
    "jlc": {"name": "Jaeger-LeCoultre", "confidence": 0.85},
    "panerai": {"name": "Panerai", "confidence": 1.0},
    "tag heuer": {"name": "Tag Heuer", "confidence": 1.0},
    "tag": {"name": "Tag Heuer", "confidence": 0.80},
    "grand seiko": {"name": "Grand Seiko", "confidence": 1.0},
    "zenith": {"name": "Zenith", "confidence": 1.0},
    "breguet": {"name": "Breguet", "confidence": 1.0},
    "blancpain": {"name": "Blancpain", "confidence": 1.0},
    "h. moser": {"name": "H. Moser & Cie", "confidence": 0.95},
    "moser": {"name": "H. Moser & Cie", "confidence": 0.85},
    "fp journe": {"name": "F.P. Journe", "confidence": 0.95},
    "fpj": {"name": "F.P. Journe", "confidence": 0.90},
    "f.p. journe": {"name": "F.P. Journe", "confidence": 1.0},
    "jacob": {"name": "Jacob & Co.", "confidence": 0.85},
    "jacob & co": {"name": "Jacob & Co.", "confidence": 1.0},
    "parmigiani": {"name": "Parmigiani Fleurier", "confidence": 0.95},
    "roger dubuis": {"name": "Roger Dubuis", "confidence": 1.0},
    "franck muller": {"name": "Franck Muller", "confidence": 1.0},
    "van cleef": {"name": "Van Cleef & Arpels", "confidence": 0.95},
    "bvlgari": {"name": "Bvlgari", "confidence": 1.0},
    "chanel": {"name": "Chanel", "confidence": 0.90},
}

# Reference prefix → brand mapping (for lines without explicit brand name)
REFERENCE_BRAND_MAP = {
    # Rolex: 4-6 digit numbers, sometimes with letters
    "126": "Rolex", "116": "Rolex", "228": "Rolex", "226": "Rolex",
    "278": "Rolex", "279": "Rolex", "336": "Rolex", "277": "Rolex",
    "128": "Rolex", "127": "Rolex", "124": "Rolex", "134": "Rolex",
    "525": "Rolex", "864": "Rolex", "118": "Rolex",
    # AP: 5 digits usually starting with 15, 26, 77, 67
    "15": "Audemars Piguet", "26": "Audemars Piguet",
    "77": "Audemars Piguet", "67": "Audemars Piguet",
    # Patek: 4 digits
    "57": "Patek Philippe", "59": "Patek Philippe", "51": "Patek Philippe",
    "52": "Patek Philippe", "53": "Patek Philippe", "58": "Patek Philippe",
    "61": "Patek Philippe", "70": "Patek Philippe", "71": "Patek Philippe",
    "72": "Patek Philippe", "73": "Patek Philippe", "49": "Patek Philippe",
    # RM: 2-digit hyphenated
    "07-": "Richard Mille", "11-": "Richard Mille", "03": "Richard Mille",
    "35-": "Richard Mille", "65-": "Richard Mille", "67-": "Richard Mille",
    "72-": "Richard Mille",
    # VC
    "4000": "Vacheron Constantin", "4300": "Vacheron Constantin",
    "4500": "Vacheron Constantin", "4520": "Vacheron Constantin",
    "4600": "Vacheron Constantin", "5500": "Vacheron Constantin",
    "6000": "Vacheron Constantin",
    # Cartier
    "WSPN": "Cartier", "WSSA": "Cartier", "WGTA": "Cartier",
    "WSTA": "Cartier", "HPI": "Cartier", "WHSA": "Cartier",
    # Tudor
    "79": "Tudor", "M35": "Tudor", "M79": "Tudor", "M91": "Tudor",
    # IWC
    "IW": "IWC",
}

# Material suffix mapping
MATERIAL_SUFFIX = {
    "or": "Rose Gold", "OR": "Rose Gold",
    "st": "Stainless Steel", "ST": "Stainless Steel",
    "ti": "Titanium", "TI": "Titanium",
    "ba": "Yellow Gold", "BA": "Yellow Gold",
    "bc": "White Gold", "BC": "White Gold",
    "wg": "White Gold", "WG": "White Gold",
    "rg": "Rose Gold", "RG": "Rose Gold",
    "io": "Titanium/Ceramic", "IO": "Titanium/Ceramic",
    "ce": "Ceramic", "CE": "Ceramic",
    "cd": "Ceramic", "CD": "Ceramic",
    "cb": "Ceramic", "CB": "Ceramic",
    "ok": "Rose Gold Variant", "OK": "Rose Gold Variant",
    "sg": "Sedna Gold", "SG": "Sedna Gold",
    "sr": "Steel + Rose Gold", "SR": "Steel + Rose Gold",
    "sp": "Steel + Platinum", "SP": "Steel + Platinum",
    "sa": "Steel + Gold", "SA": "Steel + Gold",
    "ic": "Titanium/Ceramic", "IC": "Titanium/Ceramic",
    "xt": "Carbon/TPT", "XT": "Carbon/TPT",
    "nt": "NTPT Carbon", "NT": "NTPT Carbon",
    "fo": "Forged Carbon", "FO": "Forged Carbon",
}

# Patek material suffixes in references
PATEK_MATERIAL = {
    "A": "Stainless Steel", "1A": "Stainless Steel",
    "R": "Rose Gold", "1R": "Rose Gold",
    "G": "White Gold", "1G": "White Gold",
    "J": "Yellow Gold", "1J": "Yellow Gold",
    "P": "Platinum",
    "AR": "Steel + Rose Gold",
    "GR": "White Gold + Rose Gold",
}

# N-Month code → month number
N_MONTHS = {
    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
    "7": 7, "8": 8, "9": 9, "10": 10, "11": 11, "12": 12,
}

# Condition normalization
CONDITION_MAP = {
    "new": "new", "brand new": "new", "bnib": "new",
    "used": "pre-owned", "pre-owned": "pre-owned", "pre owned": "pre-owned",
    "like new": "like-new", "unworn": "unworn",
    "nos": "new-old-stock", "mint": "mint",
    "good": "good", "worn": "worn",
}

# Color slang → normalized
COLOR_SLANG = {
    "blk": "Black", "black": "Black",
    "blue": "Blue", "blu": "Blue",
    "green": "Green", "grn": "Green",
    "white": "White", "wht": "White",
    "grey": "Grey", "gray": "Grey",
    "red": "Red",
    "silver": "Silver",
    "choco": "Chocolate", "chocolate": "Chocolate", "cho": "Chocolate",
    "champ": "Champagne", "champagne": "Champagne",
    "salmon": "Salmon",
    "brown": "Brown",
    "yellow": "Yellow",
    "orange": "Orange",
    "purple": "Purple",
    "pink": "Pink",
    "tiffany": "Tiffany Blue", "tiff": "Tiffany Blue",
    "meteorite": "Meteorite", "mete": "Meteorite",
    "ice blue": "Ice Blue",
    "pistachio": "Pistachio Green",
    "candy pink": "Candy Pink",
    "lavender": "Lavender",
    "pikachu": "Pikachu Yellow",
    "wim": "Wimbledon", "wimbledon": "Wimbledon",
    "salted egg": "Yellow Gold", "salted egg yolk": "Yellow Gold",
    "onyx": "Onyx",
    "sodalite": "Sodalite",
    "mop": "Mother of Pearl",
    "pave": "Pavé Diamond", "paved": "Pavé Diamond",
    "rainbow": "Rainbow", "rbw": "Rainbow",
    "ombre": "Ombré",
    "frost gold": "Frost Gold",
    "wordless book": "Multi-Color",
    "cotton candy": "Cotton Candy",
}

# Known collaboration / edition names (case-insensitive match)
COLLABORATIONS = [
    "kaws", "black panther", "mancini", "ferrari", "1017 alyx",
    "le mans", "argentina", "america", "japan", "italy", "qatar",
    "monaco", "indy 500", "graffiti",
]
