from pathlib import Path
from PIL import Image, ImageOps

source = Path("APK LOGO.png")
target = Path("app/src/main/res/mipmap-nodpi/ic_launcher.png")
target.parent.mkdir(parents=True, exist_ok=True)

with Image.open(source) as image:
    image = image.convert("RGBA")
    # Remove only transparent outer padding before making the square launcher asset.
    alpha = image.getchannel("A")
    bounds = alpha.getbbox()
    if bounds:
        image = image.crop(bounds)
    # Fill the complete square icon area; keep the splash image itself unchanged.
    icon = ImageOps.fit(image, (512, 512), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    icon.save(target, format="PNG", optimize=True)
