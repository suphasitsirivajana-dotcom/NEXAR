# src = source (source code, โค้ดต้นฉบับ)

โฟลเดอร์นี้เก็บ **โค้ดของโปรแกรม NEXAR ทั้งหมด** แบ่งชั้นแบบเดียวกับ `Nexbim/src/` เพื่อให้เข้าใจง่ายและไม่พึ่งพากันข้ามชั้น

| โฟลเดอร์ | คืออะไร | เทียบกับ NEXBIM |
|---|---|---|
| `Core/` | เครื่องยนต์หลัก: ระบบพิกัด, ข้อมูลโปรเจกต์/บันทึก, ตัวโหลดโมเดล, เซนเซอร์/QR (ห้ามเรียก `App/` หรือ `Exporters/`) | `Nexbim/src/Core/` |
| `Exporters/` | ส่งออกไฟล์อ่านอย่างเดียว: BCF 3.0, IFC + Marks, Interactive HTML | `Nexbim/src/Exporters/` |
| `App/` | หน้าจอโปรแกรมและ Viewport 3D / Walk / AR (`Nexar.Web`) | `Nexbim/src/App/` |

ไฟล์อื่นนอก `src/` เช่น `brand/`, `docs/`, `settings/`, `tools/`, `DirectoryManual/` เป็นแบรนด์ เอกสาร ค่าตั้งต้น และเครื่องมือช่วยพัฒนา
