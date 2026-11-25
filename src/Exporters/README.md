# Exporters

ส่งออกข้อมูลจากโปรเจกต์ NEXAR (อ่านอย่างเดียว ไม่แก้โมเดล)

- `bcf.js`: ส่งออก / นำเข้า BCF 3.0 (`.bcfzip`) สำหรับ Revit, NEXBIM, Navisworks, Solibri, BIMcollab, Bonsai
- `ifcmarks.js`: ส่งออก IFC + Marks (ฝังมาร์คเป็น `IfcBuildingElementProxy` พร้อม Pset `NEXAR_Markup`)
- `htmlexport.js`: ส่งออก Interactive HTML ไฟล์เดียว (ฝังโมเดล GLB + มาร์ค + รูปภาพ เปิดได้ทุกเบราว์เซอร์)
