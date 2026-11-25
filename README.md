# NEXAR

แอปตรวจงาน BIM และ AR หน้างาน (PWA + WebXR) ในตระกูล **NEX** — ดูโมเดล IFC / DXF / GLB / OBJ, เดินตรวจ (Walk), มาร์คคอมเมนต์ / Issue, ซ้อนโมเดลในกล้อง (CAM / AR) และส่งออกกลับไปที่ NEXBIM / Revit ผ่าน BCF 3.0, IFC + Marks, Interactive HTML และ Project JSON

## 📂 เริ่มอ่านที่คู่มือ

- **[DirectoryManual/directory-manual.html](DirectoryManual/directory-manual.html)** — แผนที่โฟลเดอร์และชั้นของโค้ดแบบ interactive (ดับเบิลคลิกเปิดได้เลย · 🔒 ห้ามลบ)
- **[docs/manual.html](docs/manual.html)** — คู่มือการใช้งาน NEXAR ภาษาไทย (เปิดได้จากในแอป: Export → Help → Manual)

## โฟลเดอร์หลัก (จัดเรียงเหมือน NEXBIM)

| โฟลเดอร์ | คืออะไร |
|---|---|
| `DirectoryManual/` | คู่มือแผนที่โฟลเดอร์ (ห้ามลบ) |
| `brand/` | โลโก้ NEXAR, ไอคอนแอป และชุดสี |
| `docs/` | คู่มือผู้ใช้ (`manual.html`), คู่มือ Revit/Unity และ JSON Schema |
| `settings/` | ค่าตั้งต้นของแอป (`defaults.js`) |
| `src/` | โค้ดโปรแกรมทั้งหมด แบ่งชั้น `Core/` · `Exporters/` · `App/` |
| `samples/` | โมเดล IFC ตัวอย่างสำหรับทดสอบ |
| `tools/` | เครื่องมือช่วยพัฒนา (`dirmap.py`, `make_assets.py`) |

## รันทดสอบบนคอม (Development)

ดับเบิลคลิก `Start NEXAR.bat` หรือรันจากโฟลเดอร์บนสุด:

```powershell
python -m http.server 5173 --directory Nexar
```

แล้วเปิด http://localhost:5173

## อัปเดตแผนที่โฟลเดอร์

หลังเพิ่ม / ย้าย / ลบไฟล์หรือโฟลเดอร์ แก้ `DirectoryManual/descriptions.yaml` แล้วรัน:

```powershell
python tools/dirmap.py
```

## เผยแพร่ใช้งานบนมือถือ / iPad (GitHub Pages — ต้องใช้ HTTPS)

1. อัปโหลดไฟล์ทั้งหมดในโฟลเดอร์ `Nexar` ขึ้น GitHub repository
2. Settings → Pages → Deploy from branch → `main` / `(root)`
3. เปิด `https://<user>.github.io/<repo>/` แล้วติดตั้งเป็นแอป (Add to Home Screen / Install app)
