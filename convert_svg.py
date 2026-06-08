import cairosvg
import os

# 读取SVG
svg_path = os.path.join("assets", "image", "wave.svg")
with open(svg_path, 'r', encoding='utf-8') as f:
    svg_content = f.read()

# 将灰色改为白色浪花
svg_content = svg_content.replace('#8D8D8D', '#FFFFFF')

# 转换为PNG
png_path = os.path.join("assets", "image", "wave.png")
cairosvg.svg2png(
    bytestring=svg_content.encode('utf-8'),
    write_to=png_path,
    output_width=24,
    output_height=24
)

print(f"Converted {svg_path} to {png_path}")
