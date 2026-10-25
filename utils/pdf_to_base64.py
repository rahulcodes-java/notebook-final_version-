import fitz  # PyMuPDF
import sys
import base64
import json
import warnings

# Suppress all warnings
warnings.filterwarnings("ignore")
fitz.TOOLS.mupdf_display_errors(False)

def pdf_to_images(pdf_path):
    doc = fitz.open(pdf_path)
    images = []
    for page_num in range(len(doc)):
        page = doc.load_page(page_num)
        pix = page.get_pixmap()
        img_data = pix.tobytes("png")
        b64_img = base64.b64encode(img_data).decode('utf-8')
        images.append(b64_img)
    return images

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python pdf_to_base64.py <pdf_path>")
        sys.exit(1)
        
    pdf_path = sys.argv[1]
    try:
        b64_images = pdf_to_images(pdf_path)
        print(json.dumps({"success": True, "images": b64_images}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
