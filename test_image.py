from PIL import Image, ImageTk
import tkinter as tk
import os

print("Current working directory:", os.getcwd())
print("Image file exists:", os.path.exists('assets/image/fish.jpg'))

try:
    root = tk.Tk()
    root.withdraw()  # 隐藏窗口

    img = Image.open('assets/image/fish.jpg')
    print("Original image mode:", img.mode)
    print("Original image size:", img.size)

    if img.mode != 'RGB':
        img = img.convert('RGB')
        print("Converted to RGB mode")

    resized = img.resize((32, 20), Image.Resampling.LANCZOS)
    photo = ImageTk.PhotoImage(resized)
    print("Image loaded successfully!")

except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
