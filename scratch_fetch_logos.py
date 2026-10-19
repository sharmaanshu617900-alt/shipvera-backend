import urllib.request
import json
import os

os.makedirs('assets/logos', exist_ok=True)

headers = {'User-Agent': 'ShipveraBot/1.0 (anshu@shipvera.in)'}

# 1. Wikimedia API query for Blue Dart, Delhivery, Shiprocket
titles = "File:Delhivery_Logo_(2019).png|File:Blue_Dart_Express_logo.svg|File:SR-logo-wiki.png"
api_url = f"https://commons.wikimedia.org/w/api.php?action=query&titles={titles}&prop=imageinfo&iiprop=url&format=json"

req = urllib.request.Request(api_url, headers=headers)
try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        pages = data.get('query', {}).get('pages', {})
        for page_id, page_info in pages.items():
            title = page_info.get('title', '')
            imageinfo = page_info.get('imageinfo', [])
            if imageinfo:
                url = imageinfo[0].get('url')
                print(f"Found {title} -> {url}")
                filename = ""
                if "Delhivery" in title:
                    filename = "assets/logos/delhivery.png"
                elif "Blue_Dart" in title:
                    filename = "assets/logos/bluedart.svg"
                elif "SR-logo" in title:
                    filename = "assets/logos/shiprocket.png"
                if filename:
                    img_req = urllib.request.Request(url, headers=headers)
                    with urllib.request.urlopen(img_req) as img_resp, open(filename, 'wb') as f:
                        f.write(img_resp.read())
                    print(f"Saved {filename}")
except Exception as e:
    print(f"Wikimedia error: {e}")

# 2. SimpleIcons CDN for Shopify, WhatsApp, Razorpay
simple_icons = {
    'shopify': 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/shopify.svg',
    'whatsapp': 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/whatsapp.svg',
    'razorpay': 'https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/razorpay.svg'
}

for name, url in simple_icons.items():
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp, open(f'assets/logos/{name}.svg', 'wb') as f:
            f.write(resp.read())
        print(f"Saved assets/logos/{name}.svg")
    except Exception as e:
        print(f"Error downloading {name}: {e}")
