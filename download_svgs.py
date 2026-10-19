import urllib.request
import os

os.makedirs('assets/logos', exist_ok=True)
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

urls = {
    'bluedart.svg': 'https://upload.wikimedia.org/wikipedia/commons/6/6c/Blue_Dart_Express_logo.svg',
    'shadowfax.svg': 'https://www.shadowfax.in/logo_header_tm.svg',
    'shopify.svg': 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/shopify.svg',
    'whatsapp.svg': 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg',
    'razorpay.svg': 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/razorpay.svg'
}

for fname, url in urls.items():
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp, open(f'assets/logos/{fname}', 'wb') as f:
            f.write(resp.read())
        print(f"Successfully saved assets/logos/{fname}")
    except Exception as e:
        print(f"Error {fname}: {e}")
