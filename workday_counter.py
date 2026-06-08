import tkinter as tk
from tkinter import messagebox, simpledialog, ttk
from datetime import datetime, timedelta, date
import json
import os
import sys
import ctypes
import io
try:
    from PIL import Image, ImageTk
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False


def get_resource_path(relative_path):
    """获取资源文件路径，兼容 PyInstaller 打包模式"""
    if getattr(sys, 'frozen', False):
        # PyInstaller 打包后的临时目录
        base_path = sys._MEIPASS
    else:
        # 开发模式：脚本所在目录
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


# ============================================================
# Windows DPI 感知（解决高分辨率屏幕模糊）
# ============================================================
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

# ============================================================
# 法定节假日数据（2024-2026年国务院公布）
# ============================================================
HOLIDAYS = {
    # 2024年
    "2024-01-01",
    "2024-02-10", "2024-02-11", "2024-02-12", "2024-02-13",
    "2024-02-14", "2024-02-15", "2024-02-16", "2024-02-17",
    "2024-04-04", "2024-04-05", "2024-04-06",
    "2024-05-01", "2024-05-02", "2024-05-03", "2024-05-04", "2024-05-05",
    "2024-06-10",
    "2024-09-15", "2024-09-16", "2024-09-17",
    "2024-10-01", "2024-10-02", "2024-10-03", "2024-10-04",
    "2024-10-05", "2024-10-06", "2024-10-07",

    # 2025年
    "2025-01-01",
    "2025-01-28", "2025-01-29", "2025-01-30", "2025-01-31",
    "2025-02-01", "2025-02-02", "2025-02-03", "2025-02-04",
    "2025-04-04", "2025-04-05", "2025-04-06",
    "2025-05-01", "2025-05-02", "2025-05-03", "2025-05-04", "2025-05-05",
    "2025-05-31", "2025-06-01", "2025-06-02",
    "2025-10-01", "2025-10-02", "2025-10-03", "2025-10-04",
    "2025-10-05", "2025-10-06", "2025-10-07", "2025-10-08",

    # 2026年
    "2026-01-01", "2026-01-02", "2026-01-03",
    "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18",
    "2026-02-19", "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23",
    "2026-04-04", "2026-04-05", "2026-04-06",
    "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05",
    "2026-06-19", "2026-06-20", "2026-06-21",
    "2026-09-25", "2026-09-26", "2026-09-27",
    "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    "2026-10-05", "2026-10-06", "2026-10-07",
}

WORK_WEEKENDS = {
    "2024-02-04", "2024-02-18",
    "2024-04-07",
    "2024-04-28", "2024-05-11",
    "2024-09-14",
    "2024-09-29", "2024-10-12",

    "2025-01-26", "2025-02-08",
    "2025-04-27",
    "2025-09-28", "2025-10-11",

    "2026-01-04",
    "2026-02-14", "2026-02-28",
    "2026-05-09",
    "2026-09-20", "2026-10-10",
}

WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]


def is_rest_day(d: date) -> bool:
    """判断某天是否休息"""
    date_str = d.strftime("%Y-%m-%d")
    if date_str in WORK_WEEKENDS:
        return False
    if date_str in HOLIDAYS:
        return True
    if d.weekday() >= 5:
        return True
    return False


def days_until_next_rest(today: date) -> int:
    """计算距离下一个休息日的天数"""
    if is_rest_day(today):
        return 0
    days = 0
    d = today
    while not is_rest_day(d):
        days += 1
        d += timedelta(days=1)
    return days


def get_next_rest_date(today: date) -> date:
    """获取下一个休息日的日期"""
    d = today
    while not is_rest_day(d):
        d += timedelta(days=1)
    return d


def is_work_day(d: date) -> bool:
    """判断某天是否为工作日"""
    return not is_rest_day(d)


def get_next_work_day(target_date: date) -> date:
    """获取指定日期后的第一个工作日（如果指定日期本身就是工作日，则返回该日期）"""
    d = target_date
    while not is_work_day(d):
        d += timedelta(days=1)
    return d


class FishProgressBar(tk.Canvas):
    """摸鱼主题进度条 - 流动光带、游动小鱼、推进水花"""

    def __init__(self, parent, height=48, **kwargs):
        super().__init__(parent, height=height,
                         bg=parent.cget("bg"), highlightthickness=0, **kwargs)
        self.height = height
        self.width = 1
        self.progress = 0
        self.target_progress = 0
        self.flow_offset = 0  # 流动光带偏移
        self.fish_bounce = 0  # 小鱼游动偏移
        self.fish_direction = 1  # 小鱼游动方向
        self.splash_particles = []  # 水花粒子
        self.fish_image = None
        self.wave_image = None
        # 浪花摇摆状态
        self.wave_sway_offsets = [0, 0, 0]
        self.wave_sway_directions = [1, -1, 1]
        self.load_fish_image()
        self.load_wave_image()
        self.bind("<Configure>", self._on_resize)
        self.draw(0)
        self.start_animation()

    def _on_resize(self, event=None):
        self.width = self.winfo_width()
        self.draw(self.progress)

    def set_progress(self, value):
        """设置目标进度值"""
        target = max(0, min(100, value))
        # 水花粒子已禁用
        # if target > self.progress + 0.5:
        #     self._add_splash()
        self.target_progress = target
        self._animate_progress()

    def _animate_progress(self):
        """平滑动画过渡到目标进度"""
        if abs(self.progress - self.target_progress) > 0.5:
            diff = self.target_progress - self.progress
            self.progress += diff * 0.08
            self.draw(self.progress)
            self.after(40, self._animate_progress)
        else:
            self.progress = self.target_progress
            self.draw(self.progress)

    def _add_splash(self):
        """添加推进水花粒子"""
        progress_width = self.width * (self.progress / 100)
        # 在进度末端生成多个水花粒子
        for _ in range(5):
            self.splash_particles.append({
                'x': progress_width,
                'y': self.height // 2 + (hash(str(_)) % 20 - 10),
                'vx': (hash(str(_)+"x") % 10 - 5) * 0.5,
                'vy': (hash(str(_)+"y") % 10 - 8) * 0.5,
                'size': hash(str(_)+"s") % 6 + 3,
                'life': 1.0,
                'decay': 0.02 + (hash(str(_)+"d") % 10) * 0.005
            })

    def _add_splash_at_position(self, x, y):
        """添加水滴溅射粒子 - 快速抛出、明显下落"""
        # 水滴溅射：速度快、重力明显、短促有力
        splash_configs = [
            # (x偏移, y偏移, vx, vy, 大小)
            (0, -2, 3.5, -4.0, 7),      # 右上飞溅
            (2, 0, 4.5, -2.5, 6),       # 右侧飞溅
            (1, 2, 3.0, -1.0, 8),       # 右下飞溅
            (4, -1, 5.0, -3.5, 5),      # 更远的右侧
            (-1, 0, 2.0, -2.0, 6),      # 原地飞溅
        ]

        for i, (dx, dy, vx, vy, size) in enumerate(splash_configs):
            # 添加随机变化
            rand_vx = (hash(str(i)+"vx") % 6 - 3) * 0.3
            rand_vy = (hash(str(i)+"vy") % 6 - 3) * 0.3

            self.splash_particles.append({
                'x': x + dx,
                'y': y + dy,
                'vx': vx + rand_vx,      # 快速初始速度
                'vy': vy + rand_vy,      # 向上抛出
                'size': size,
                'life': 1.0,
                'decay': 0.018,          # 适中衰减，能看到完整轨迹
            })

    def start_animation(self):
        """启动持续动画"""
        self._animate_frame()

    def _animate_frame(self):
        """每帧动画更新"""
        # 更新流动光带（降低速度）
        self.flow_offset = (self.flow_offset + 1) % 60
        # 更新小鱼游动
        self.fish_bounce += 0.15 * self.fish_direction
        if abs(self.fish_bounce) > 3:
            self.fish_direction *= -1
        # 水花粒子已禁用
        # self._update_splash()
        # 重绘
        self.draw(self.progress)
        self.after(50, self._animate_frame)

    def _update_splash(self):
        """更新水滴粒子 - 明显重力下落"""
        new_particles = []
        for p in self.splash_particles:
            p['x'] += p['vx']
            p['y'] += p['vy']
            p['vy'] += 0.25  # 明显重力
            p['vx'] *= 0.98  # 空气阻力
            p['life'] -= p['decay']
            if p['life'] > 0:
                new_particles.append(p)
        self.splash_particles = new_particles

    def draw(self, value):
        self.progress = max(0, min(100, value))
        self.delete("all")

        bar_height = 32
        bar_y = (self.height - bar_height) // 2
        progress_width = self.width * (self.progress / 100)

        # 绘制水波纹背景
        water_color = "#e3f2fd"
        self.create_rectangle(0, bar_y, self.width, bar_y + bar_height,
                              fill=water_color, outline="")

        # 绘制进度区域
        if self.progress > 0:
            progress_color = "#2196f3"
            self.create_rectangle(0, bar_y, progress_width, bar_y + bar_height,
                                  fill=progress_color, outline="")

            # 绘制流动光带效果
            self._draw_flow_light(progress_width, bar_y, bar_height)

            # 水花粒子已禁用
            # self._draw_splash()

            # 绘制游动的小鱼
            if self.fish_image is not None:
                self._draw_fish_image(progress_width, bar_y, bar_height)
            else:
                self._draw_animated_fish(progress_width, bar_y, bar_height)

        # 绘制水波纹边框
        border_color = "#bbdefb"
        self.create_line(0, bar_y, self.width, bar_y,
                         fill=border_color, width=1)
        self.create_line(0, bar_y + bar_height, self.width, bar_y + bar_height,
                         fill=border_color, width=1)

        # 百分比文字 - 根据是否被进度条覆盖切换颜色
        text = f"{int(self.progress)}%"
        text_x = self.width // 2
        text_y = self.height // 2

        # 检测进度条是否覆盖了文字中心
        progress_width = self.width * (self.progress / 100)
        is_covered = progress_width > text_x

        if is_covered:
            # 被覆盖：白色填充 + 蓝色描边
            outline_color = "#1976d2" if self.progress > 0 else "#90a4ae"
            fill_color = "#ffffff"
        else:
            # 未被覆盖：蓝色填充 + 白色描边
            outline_color = "#ffffff"
            fill_color = "#1976d2" if self.progress > 0 else "#90a4ae"

        # 绘制描边（上下左右各偏移1像素）
        for dx, dy in [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]:
            self.create_text(
                text_x + dx, text_y + dy,
                text=text,
                fill=outline_color,
                font=("Microsoft YaHei", 12, "bold")
            )

        # 绘制主文字
        self.create_text(
            text_x, text_y,
            text=text,
            fill=fill_color,
            font=("Microsoft YaHei", 12, "bold")
        )

    def _draw_flow_light(self, progress_width, bar_y, bar_height):
        """绘制流动光带效果 - 使用浪花图片，带摇摆动画"""
        if progress_width < 20:
            return

        # 更新浪花摇摆状态（增大翻涌幅度）
        for i in range(3):
            self.wave_sway_offsets[i] += self.wave_sway_directions[i] * 0.8
            if abs(self.wave_sway_offsets[i]) > 16:
                self.wave_sway_directions[i] *= -1

        # 创建多个流动浪花
        for i in range(3):
            offset = (self.flow_offset + i * 20) % 60
            light_x = offset / 60.0 * progress_width
            if light_x < progress_width:
                # 使用浪花图片
                if self.wave_image is not None:
                    # 添加摇摆偏移
                    sway_x = light_x + (hash(str(i)) %
                                        6 - 3) * (self.wave_sway_offsets[i] / 8)
                    sway_y = bar_y + bar_height // 2 + \
                        (hash(str(i)+"y") % 8 - 4) * \
                        (self.wave_sway_offsets[i] / 8)
                    self.create_image(
                        sway_x, sway_y,
                        image=self.wave_image,
                        anchor="center"
                    )
                    # 水花粒子已禁用
                    # if light_x > progress_width - 16 and offset > 50:
                    #     self._add_splash_at_position(light_x, sway_y)
                else:
                    # 备用：椭圆光斑
                    size = 8 - abs(offset - 30) / 30 * 4
                    alpha = 0.3 + (1 - abs(offset - 30) / 30) * 0.4
                    light_color = f"#{int(100+155*alpha):02x}{int(150+105*alpha):02x}{int(200+55*alpha):02x}"
                    self.create_oval(
                        light_x - size, bar_y + 4,
                        light_x + size, bar_y + bar_height - 4,
                        fill=light_color, outline=""
                    )

    def _draw_splash(self):
        """绘制水滴粒子 - 深蓝半透明水滴效果"""
        for p in self.splash_particles:
            alpha = p['life']
            size = p['size'] * alpha

            # 水滴主体：深蓝色半透明
            r = int(30 + 40 * alpha)
            g = int(100 + 60 * alpha)
            b = int(200 + 55 * alpha)
            body_color = f"#{r:02x}{g:02x}{b:02x}"

            # 绘制水滴主体（椭圆）
            self.create_oval(
                p['x'] - size, p['y'] - size * 1.2,
                p['x'] + size, p['y'] + size * 1.2,
                fill=body_color, outline=""
            )

            # 水滴高光（白色小圆点）
            if size > 2:
                highlight_size = size * 0.3
                self.create_oval(
                    p['x'] - highlight_size, p['y'] -
                    size * 0.8 - highlight_size,
                    p['x'] + highlight_size, p['y'] -
                    size * 0.8 + highlight_size,
                    fill="#ffffff", outline=""
                )

    def _draw_animated_fish(self, progress_width, bar_y, bar_height):
        """绘制游动动画的小鱼"""
        if progress_width < 30:
            return

        fish_x = progress_width - 20
        fish_y = bar_y + bar_height // 2 + self.fish_bounce

        if fish_x > 10:
            fish_color = "#ffffff"

            # 鱼身体 - 随游动轻微变形
            body_offset = abs(self.fish_bounce) * 0.5
            self.create_oval(
                fish_x - 10 - body_offset, fish_y - 6,
                fish_x + 10 + body_offset, fish_y + 6,
                outline=fish_color, fill="", width=2
            )

            # 摆动的尾巴
            tail_wag = self.fish_bounce * 1.5
            tail_points = [
                fish_x - 10, fish_y - 8 + tail_wag,
                fish_x - 20, fish_y + tail_wag * 2,
                fish_x - 10, fish_y + 8 + tail_wag
            ]
            self.create_polygon(tail_points, fill=fish_color, outline="")

            # 鱼鳍
            fin_wag = self.fish_bounce * 0.8
            self.create_line(
                fish_x - 4, fish_y - 6,
                fish_x + 4 + fin_wag, fish_y - 12,
                fill=fish_color, width=1.5
            )

            # 鱼眼睛
            self.create_oval(
                fish_x + 4, fish_y - 3,
                fish_x + 8, fish_y + 1,
                fill=fish_color, outline=""
            )

    def load_fish_image(self):
        """加载小鱼图片"""
        if not PIL_AVAILABLE:
            self.fish_image = None
            return
        try:
            image_path = get_resource_path(
                os.path.join("assets", "image", "fish.jpg"))
            if os.path.exists(image_path):
                original_image = Image.open(image_path)
                # 保持图片原有模式（包括透明通道）
                # 使用正方形尺寸，保持宽高比例
                resized_image = original_image.resize(
                    (36, 36), Image.Resampling.LANCZOS)
                self.fish_image = ImageTk.PhotoImage(resized_image)
            else:
                self.fish_image = None
        except Exception:
            self.fish_image = None

    def load_wave_image(self):
        """加载浪花图片并转换为白色"""
        if not PIL_AVAILABLE:
            self.wave_image = None
            return
        try:
            image_path = get_resource_path(
                os.path.join("assets", "image", "wave-fin.png"))
            if os.path.exists(image_path):
                original_image = Image.open(image_path)
                # 转换为RGBA模式确保有透明通道
                if original_image.mode != 'RGBA':
                    original_image = original_image.convert('RGBA')

                # 创建白色版本
                white_image = self._convert_to_white(original_image)

                # 调整为32x32（增大浪花尺寸）
                resized_image = white_image.resize(
                    (32, 32), Image.Resampling.LANCZOS)
                self.wave_image = ImageTk.PhotoImage(resized_image)
            else:
                self.wave_image = None
        except Exception:
            self.wave_image = None

    def _convert_to_white(self, image):
        """将图片转换为白色，保持透明度"""
        # 获取图像数据
        data = image.getdata()
        new_data = []
        for item in data:
            if len(item) == 4:  # RGBA
                # 保持alpha通道，RGB设为白色(255,255,255)
                new_data.append((255, 255, 255, item[3]))
            elif len(item) == 3:  # RGB
                new_data.append((255, 255, 255))
            else:
                new_data.append(item)

        # 创建新图像
        new_image = Image.new('RGBA', image.size)
        new_image.putdata(new_data)
        return new_image

    def _draw_fish_image(self, progress_width, bar_y, bar_height):
        """绘制图片小鱼（带动画偏移）"""
        if progress_width < 20 or self.fish_image is None:
            return
        fish_x = progress_width - 28  # 调整位置，让小鱼居中显示
        fish_y = bar_y + (bar_height - 36) // 2 + self.fish_bounce
        if fish_x > 0 and fish_y > 0:
            self.create_image(
                fish_x, fish_y, image=self.fish_image, anchor="nw")


class WorkDayCounter:
    COLORS = {
        "bg": "#eef2f7",
        "card_bg": "#ffffff",
        "card_border": "#dce4ec",
        "primary": "#3b82f6",
        "accent": "#2563eb",
        "success": "#059669",
        "warning": "#d97706",
        "danger": "#dc2626",
        "text": "#1e293b",
        "text_light": "#64748b",
        "progress_bg": "#e3f2fd",
        "progress_fg": "#2196f3",
        "button_bg": "#2563eb",
        "button_fg": "#ffffff",
        "button_hover": "#1d4ed8",
        "secondary_btn_bg": "#f1f5f9",
        "secondary_btn_fg": "#334155",
        "secondary_btn_hover": "#e2e8f0",
    }

    def __init__(self, root):
        self.root = root
        self.root.title("Workday Escape")
        self.root.geometry("720x830")
        self.root.minsize(480, 400)
        self.root.configure(bg=self.COLORS["bg"])

        # 加载配置
        if getattr(sys, 'frozen', False):
            app_dir = os.path.dirname(sys.executable)
        else:
            app_dir = os.path.dirname(os.path.abspath(__file__))
        self.config_file = os.path.join(app_dir, "config.json")
        self.config = self.load_config()

        self.timer_id = None
        self.setup_ui()
        self.update_display()
        self.start_timer()

    def load_config(self):
        default_config = {
            "start_date": "2025-07-17",
            "salary_day": 10,
            "work_start_time": "08:30",
            "work_end_time": "18:00",
            "overtime_minutes": 0
        }
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except:
                return default_config
        return default_config

    def save_config(self):
        with open(self.config_file, "w", encoding="utf-8") as f:
            json.dump(self.config, f, ensure_ascii=False, indent=2)

    def create_card(self, parent, title, value, color=None, subtitle=""):
        """创建数据卡片"""
        outer = tk.Frame(parent, bg=self.COLORS["card_border"], padx=1, pady=1)
        outer.pack(fill=tk.X, pady=(14, 6), padx=20)

        card = tk.Frame(outer, bg=self.COLORS["card_bg"], padx=20, pady=16)
        card.pack(fill=tk.BOTH, expand=True)

        tk.Label(card, text=title, font=("Microsoft YaHei", 10),
                 fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"]
                 ).pack(anchor=tk.W)

        val_color = color if color else self.COLORS["text"]
        value_lbl = tk.Label(card, text=value, font=("Microsoft YaHei", 22, "bold"),
                             fg=val_color, bg=self.COLORS["card_bg"])
        value_lbl.pack(anchor=tk.W, pady=(6, 0))

        sub_lbl = None
        if subtitle:
            sub_lbl = tk.Label(card, text=subtitle, font=("Microsoft YaHei", 9),
                               fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"])
            sub_lbl.pack(anchor=tk.W, pady=(4, 0))

        return value_lbl, sub_lbl, outer

    def setup_ui(self):
        # ========== 顶部标题栏（固定，不滚动）==========
        header = tk.Frame(
            self.root, bg=self.COLORS["primary"], padx=20, pady=14)
        header.pack(fill=tk.X, side=tk.TOP)

        tk.Label(header, text="今天你摸鱼了吗？",
                 font=("Microsoft YaHei", 14, "bold"),
                 fg="white", bg=self.COLORS["primary"]
                 ).pack(anchor=tk.W)

        # ========== 中间可滚动内容区 ==========
        canvas_container = tk.Frame(self.root, bg=self.COLORS["bg"])
        canvas_container.pack(fill=tk.BOTH, expand=True)

        self.canvas = tk.Canvas(canvas_container, bg=self.COLORS["bg"],
                                highlightthickness=0, bd=0)
        self.scrollbar = ttk.Scrollbar(canvas_container, orient="vertical",
                                       command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)

        self.scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        self.content = tk.Frame(self.canvas, bg=self.COLORS["bg"])
        self.canvas_window = self.canvas.create_window(
            (0, 0), window=self.content, anchor="nw"
        )

        self.content.bind("<Configure>", self.on_content_configure)
        self.canvas.bind("<Configure>", self.on_canvas_configure)
        self.canvas.bind_all("<MouseWheel>", self.on_mousewheel)
        self.canvas.bind_all("<Button-4>", self.on_mousewheel)
        self.canvas.bind_all("<Button-5>", self.on_mousewheel)

        # ---------- 已上班天数 ----------
        self.work_days_label, _, _ = self.create_card(
            self.content, "已上班天数", "0 天", self.COLORS["text"]
        )

        # ---------- 休息日和发薪日（同一行各占一半）----------
        row_frame = tk.Frame(self.content, bg=self.COLORS["bg"])
        row_frame.pack(fill=tk.X, pady=6, padx=20)
        row_frame.columnconfigure(0, weight=1)
        row_frame.columnconfigure(1, weight=1)

        # 休息日卡片
        rest_outer = tk.Frame(
            row_frame, bg=self.COLORS["card_border"], padx=1, pady=1)
        rest_outer.grid(row=0, column=0, sticky="nsew", padx=(0, 6))
        rest_card = tk.Frame(
            rest_outer, bg=self.COLORS["card_bg"], padx=16, pady=14)
        rest_card.pack(fill=tk.BOTH, expand=True)

        tk.Label(rest_card, text="距离下一个休息日", font=("Microsoft YaHei", 10),
                 fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"]
                 ).pack(anchor=tk.W)
        self.rest_label = tk.Label(rest_card, text="0 天",
                                   font=("Microsoft YaHei", 20, "bold"),
                                   fg=self.COLORS["accent"], bg=self.COLORS["card_bg"])
        self.rest_label.pack(anchor=tk.W, pady=(4, 0))
        self.rest_subtitle = tk.Label(rest_card, text="包含双休及法定节假日",
                                      font=("Microsoft YaHei", 9),
                                      fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"])
        self.rest_subtitle.pack(anchor=tk.W, pady=(3, 0))

        # 发薪日卡片
        salary_outer = tk.Frame(
            row_frame, bg=self.COLORS["card_border"], padx=1, pady=1)
        salary_outer.grid(row=0, column=1, sticky="nsew", padx=(6, 0))
        salary_card = tk.Frame(
            salary_outer, bg=self.COLORS["card_bg"], padx=16, pady=14)
        salary_card.pack(fill=tk.BOTH, expand=True)

        tk.Label(salary_card, text="距离发工资", font=("Microsoft YaHei", 10),
                 fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"]
                 ).pack(anchor=tk.W)
        self.salary_label = tk.Label(salary_card, text="0 天",
                                     font=("Microsoft YaHei", 20, "bold"),
                                     fg=self.COLORS["success"], bg=self.COLORS["card_bg"])
        self.salary_label.pack(anchor=tk.W, pady=(4, 0))
        self.salary_subtitle = tk.Label(salary_card, text="每月 10 号",
                                        font=("Microsoft YaHei", 9),
                                        fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"])
        self.salary_subtitle.pack(anchor=tk.W, pady=(3, 0))

        # ---------- 距离下班 ----------
        self.countdown_label, _, _ = self.create_card(
            self.content, "距离下班", "0 小时 0 分钟 0 秒", self.COLORS["warning"]
        )

        # ---------- 今日工作进度（自定义圆角进度条）----------
        progress_outer = tk.Frame(
            self.content, bg=self.COLORS["card_border"], padx=1, pady=1)
        progress_outer.pack(fill=tk.X, pady=6, padx=20)

        progress_card = tk.Frame(
            progress_outer, bg=self.COLORS["card_bg"], padx=20, pady=16)
        progress_card.pack(fill=tk.BOTH, expand=True)

        tk.Label(progress_card, text="今日工作进度", font=("Microsoft YaHei", 10),
                 fg=self.COLORS["text_light"], bg=self.COLORS["card_bg"]
                 ).pack(anchor=tk.W)

        self.progress_bar = FishProgressBar(
            progress_card, height=48
        )
        self.progress_bar.pack(fill=tk.X, pady=(10, 0), expand=True)

        # 底部信息
        info_frame = tk.Frame(self.content, bg=self.COLORS["bg"], pady=10)
        info_frame.pack(fill=tk.X, padx=20)

        self.start_date_info = tk.Label(
            info_frame, text="", font=("Microsoft YaHei", 9),
            fg=self.COLORS["text_light"], bg=self.COLORS["bg"]
        )
        self.start_date_info.pack(anchor=tk.W, pady=2)

        # ========== 底部按钮栏（固定，不滚动）==========
        button_frame = tk.Frame(
            self.root, bg=self.COLORS["bg"], padx=20, pady=14)
        button_frame.pack(fill=tk.X, side=tk.BOTTOM)

        btn_style = {
            "font": ("Microsoft YaHei", 10),
            "bg": self.COLORS["button_bg"],
            "fg": self.COLORS["button_fg"],
            "activebackground": self.COLORS["button_hover"],
            "activeforeground": self.COLORS["button_fg"],
            "bd": 0,
            "padx": 12,
            "pady": 7,
            "cursor": "hand2"
        }

        btn_style2 = {
            "font": ("Microsoft YaHei", 10),
            "bg": self.COLORS["secondary_btn_bg"],
            "fg": self.COLORS["secondary_btn_fg"],
            "activebackground": self.COLORS["secondary_btn_hover"],
            "activeforeground": self.COLORS["secondary_btn_fg"],
            "bd": 0,
            "padx": 12,
            "pady": 7,
            "cursor": "hand2"
        }

        btn_set_start = tk.Button(
            button_frame, text="上班日期", command=self.set_start_date, **btn_style)
        btn_set_start.pack(side=tk.LEFT, padx=(0, 5))

        btn_set_salary = tk.Button(
            button_frame, text="发薪日", command=self.set_salary_day, **btn_style)
        btn_set_salary.pack(side=tk.LEFT, padx=(0, 5))

        btn_set_overtime = tk.Button(
            button_frame, text="加班时长", command=self.set_overtime_minutes,
            font=("Microsoft YaHei", 10),
            bg="#ff6666",
            fg="white",
            activebackground="#ff4d4d",
            activeforeground="white",
            bd=0,
            padx=12,
            pady=7,
            cursor="hand2"
        )
        btn_set_overtime.pack(side=tk.LEFT, padx=(0, 5))

        btn_set_work_start = tk.Button(
            button_frame, text="上班时间", command=self.set_work_start_time, **btn_style2)
        btn_set_work_start.pack(side=tk.LEFT, padx=(0, 5))

        btn_set_work_end = tk.Button(
            button_frame, text="下班时间", command=self.set_work_end_time, **btn_style2)
        btn_set_work_end.pack(side=tk.LEFT, padx=(0, 5))

        btn_refresh = tk.Button(button_frame, text="刷新",
                                command=self.update_display, **btn_style2)
        btn_refresh.pack(side=tk.LEFT, padx=(0, 5))

        # 悬停效果
        for btn in [btn_set_start, btn_set_salary]:
            btn.bind("<Enter>", lambda e, b=btn: b.configure(
                bg=self.COLORS["button_hover"]))
            btn.bind("<Leave>", lambda e, b=btn: b.configure(
                bg=self.COLORS["button_bg"]))

        for btn in [btn_set_work_start, btn_set_work_end, btn_refresh]:
            btn.bind("<Enter>", lambda e, b=btn: b.configure(
                bg=self.COLORS["secondary_btn_hover"]))
            btn.bind("<Leave>", lambda e, b=btn: b.configure(
                bg=self.COLORS["secondary_btn_bg"]))

        # 加班按钮悬停效果（保持浅红色主题）
        btn_set_overtime.bind(
            "<Enter>", lambda e: btn_set_overtime.configure(bg="#ff4d4d"))
        btn_set_overtime.bind(
            "<Leave>", lambda e: btn_set_overtime.configure(bg="#ff6666"))

    def _update_scrollbar_visibility(self):
        """根据内容高度动态显示/隐藏滚动条"""
        self.root.after(10, self._do_update_scrollbar)

    def _do_update_scrollbar(self):
        canvas_height = self.canvas.winfo_height()
        content_height = self.content.winfo_height()
        if canvas_height <= 0 or content_height <= 0:
            return
        if content_height <= canvas_height:
            self.scrollbar.pack_forget()
            self.canvas.unbind_all("<MouseWheel>")
            self.canvas.unbind_all("<Button-4>")
            self.canvas.unbind_all("<Button-5>")
        else:
            self.scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
            self.canvas.bind_all("<MouseWheel>", self.on_mousewheel)
            self.canvas.bind_all("<Button-4>", self.on_mousewheel)
            self.canvas.bind_all("<Button-5>", self.on_mousewheel)

    def on_content_configure(self, event=None):
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        self._update_scrollbar_visibility()

    def on_canvas_configure(self, event=None):
        self.canvas.itemconfig(self.canvas_window, width=event.width)
        self._update_scrollbar_visibility()

    def on_mousewheel(self, event):
        if event.num == 4 or event.delta > 0:
            self.canvas.yview_scroll(-1, "units")
        elif event.num == 5 or event.delta < 0:
            self.canvas.yview_scroll(1, "units")

    def set_start_date(self):
        date_str = simpledialog.askstring(
            "设置上班开始日期",
            "请输入上班开始日期（格式：YYYY-MM-DD）",
            initialvalue=self.config["start_date"]
        )
        if date_str:
            try:
                datetime.strptime(date_str, "%Y-%m-%d")
                self.config["start_date"] = date_str
                self.save_config()
                self.update_display()
            except ValueError:
                messagebox.showerror("错误", "日期格式不正确，请使用 YYYY-MM-DD 格式")

    def set_salary_day(self):
        day = simpledialog.askinteger(
            "设置发工资日",
            "请输入每月几号发工资（1-31）",
            initialvalue=self.config["salary_day"],
            minvalue=1, maxvalue=31
        )
        if day:
            self.config["salary_day"] = day
            self.save_config()
            self.update_display()

    def set_work_start_time(self):
        time_str = simpledialog.askstring(
            "设置上班时间",
            "请输入上班时间（格式：HH:MM，如 09:00）",
            initialvalue=self.config["work_start_time"]
        )
        if time_str:
            try:
                datetime.strptime(time_str, "%H:%M")
                self.config["work_start_time"] = time_str
                self.save_config()
                self.update_display()
            except ValueError:
                messagebox.showerror("错误", "时间格式不正确，请使用 HH:MM 格式")

    def set_work_end_time(self):
        time_str = simpledialog.askstring(
            "设置下班时间",
            "请输入下班时间（格式：HH:MM，如 18:00）",
            initialvalue=self.config["work_end_time"]
        )
        if time_str:
            try:
                datetime.strptime(time_str, "%H:%M")
                self.config["work_end_time"] = time_str
                self.save_config()
                self.update_display()
            except ValueError:
                messagebox.showerror("错误", "时间格式不正确，请使用 HH:MM 格式")

    def set_overtime_minutes(self):
        # 如果当前有加班时长，提供操作选项
        current_overtime = self.config.get("overtime_minutes", 0)
        if current_overtime > 0:
            result = messagebox.askyesnocancel(
                "加班时长设置",
                f"当前加班时长: {current_overtime} 分钟\n\n选择操作:\n- 是: 保持原状\n- 否: 修改加班时长\n- 取消: 清除加班时长(设为0)"
            )
            if result is True:  # 用户选择"是" - 保持原状
                return
            elif result is False:  # 用户选择"否" - 修改
                pass  # 继续下面的输入逻辑
            else:  # 用户选择"取消" - 清除
                self.config["overtime_minutes"] = 0
                self.save_config()
                self.update_display()
                return

        minutes = simpledialog.askinteger(
            "设置加班时长",
            "请输入今天加班的分钟数（0-600）\n输入0表示不加班",
            initialvalue=self.config.get("overtime_minutes", 0),
            minvalue=0, maxvalue=600
        )
        if minutes is not None:
            self.config["overtime_minutes"] = minutes
            self.save_config()
            self.update_display()

    def update_display(self):
        now = datetime.now()
        today = now.date()

        # 已上班天数
        start_date = datetime.strptime(
            self.config["start_date"], "%Y-%m-%d").date()
        work_days = max(0, (today - start_date).days)
        self.work_days_label.config(text=f"{work_days} 天")

        # 距离下一个休息日
        rest_days = days_until_next_rest(today)
        if rest_days == 0:
            self.rest_label.config(text="今天休息！")
            self.rest_subtitle.config(text="好好享受假期吧")
        else:
            next_rest = get_next_rest_date(today)
            rest_name = next_rest.strftime("%m月%d日")
            rest_weekday = WEEKDAY_NAMES[next_rest.weekday()]
            self.rest_label.config(text=f"{rest_days} 天")
            self.rest_subtitle.config(text=f"{rest_name} ({rest_weekday})")

        # 距离发工资
        salary_day = self.config["salary_day"]
        try:
            current_month_salary = today.replace(day=salary_day)
        except ValueError:
            import calendar
            last_day = calendar.monthrange(today.year, today.month)[1]
            current_month_salary = today.replace(day=last_day)

        if today >= current_month_salary:
            if today.month == 12:
                next_salary_base = today.replace(
                    year=today.year + 1, month=1, day=1)
                try:
                    next_salary_base = next_salary_base.replace(day=salary_day)
                except ValueError:
                    import calendar
                    last_day = calendar.monthrange(
                        next_salary_base.year, next_salary_base.month)[1]
                    next_salary_base = next_salary_base.replace(day=last_day)
            else:
                try:
                    next_salary_base = today.replace(
                        month=today.month + 1, day=salary_day)
                except ValueError:
                    import calendar
                    last_day = calendar.monthrange(
                        today.year, today.month + 1)[1]
                    next_salary_base = today.replace(
                        month=today.month + 1, day=last_day)
        else:
            next_salary_base = current_month_salary

        # 如果发工资日是节假日或双休日，延后到第一个工作日
        next_salary = get_next_work_day(next_salary_base)

        # 检查是否发生了延后
        is_delayed = (next_salary != next_salary_base)

        days_until_salary = (next_salary - today).days
        self.salary_label.config(text=f"{days_until_salary} 天")

        if is_delayed:
            # 添加特殊提示：发工资日延后
            self.salary_subtitle.config(text=f"每月 {self.config['salary_day']} 号 (延后)",
                                        fg="red")
        else:
            self.salary_subtitle.config(text=f"每月 {self.config['salary_day']} 号",
                                        fg=self.COLORS["text_light"])

        # 距离下班
        work_end = datetime.strptime(
            self.config["work_end_time"], "%H:%M").time()
        work_end_datetime = datetime.combine(today, work_end)
        work_start = datetime.strptime(
            self.config["work_start_time"], "%H:%M").time()
        work_start_datetime = datetime.combine(today, work_start)

        # 添加加班时间
        overtime_minutes = self.config.get("overtime_minutes", 0)
        if overtime_minutes > 0:
            work_end_datetime += timedelta(minutes=overtime_minutes)

        if is_rest_day(today):
            self.countdown_label.config(text="今天休息！")
        elif now < work_start_datetime:
            time_diff = work_start_datetime - now
            hours = time_diff.seconds // 3600
            minutes = (time_diff.seconds % 3600) // 60
            self.countdown_label.config(text=f"还没上班，{hours}小时{minutes}分钟后开始")
        elif now >= work_end_datetime:
            if overtime_minutes > 0:
                self.countdown_label.config(text="加班结束啦！")
            else:
                self.countdown_label.config(text="已经下班啦！")
        else:
            time_diff = work_end_datetime - now
            hours = time_diff.seconds // 3600
            minutes = (time_diff.seconds % 3600) // 60
            seconds = time_diff.seconds % 60

            # 只有在超过正常下班时间后才显示加班标识
            normal_work_end = datetime.combine(today, datetime.strptime(
                self.config["work_end_time"], "%H:%M").time())

            if overtime_minutes > 0 and now > normal_work_end:
                self.countdown_label.config(
                    text=f"{hours} 小时 {minutes} 分钟 {seconds} 秒 (加班中)")
            else:
                self.countdown_label.config(
                    text=f"{hours} 小时 {minutes} 分钟 {seconds} 秒")

        # 工作日进度
        total_work_seconds = (work_end_datetime -
                              work_start_datetime).total_seconds()
        if total_work_seconds > 0:
            if is_rest_day(today):
                progress = 0
            elif now <= work_start_datetime:
                progress = 0
            elif now >= work_end_datetime:
                progress = 100
            else:
                elapsed = (now - work_start_datetime).total_seconds()
                progress = (elapsed / total_work_seconds) * 100
        else:
            progress = 0

        self.progress_bar.set_progress(progress)

        # 底部信息
        overtime_minutes = self.config.get("overtime_minutes", 0)
        overtime_text = f"{overtime_minutes} 分钟" if overtime_minutes > 0 else "无"
        start_date_obj = datetime.strptime(
            self.config["start_date"], "%Y-%m-%d")
        self.start_date_info.config(
            text=(
                f"上班开始: {start_date_obj.year}年{start_date_obj.month:02d}月{start_date_obj.day:02d}日"
                f"  |  上班时间: {self.config['work_start_time']}"
                f"  |  下班时间: {self.config['work_end_time']}"
                f"  |  加班: {overtime_text}"
            )
        )

    def start_timer(self):
        self.update_display()
        self.timer_id = self.root.after(1000, self.start_timer)

    def on_closing(self):
        if self.timer_id:
            self.root.after_cancel(self.timer_id)
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = WorkDayCounter(root)
    root.protocol("WM_DELETE_WINDOW", app.on_closing)
    root.mainloop()
