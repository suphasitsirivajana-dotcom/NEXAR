"""Generate NEXAR PNG app icons and a sample IFC4 building (pure Python stdlib).

Run from the Nexar folder:   python tools/make_assets.py
"""
import math
import os
import random
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ----------------------------------------------------------------- PNG icon
def write_png(path, w, h, pixel):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            raw.extend(pixel(x, y))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(raw), 9)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def cubic(p0, p1, p2, p3, steps=40):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1.0 - t
        x = u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0]
        y = u*u*u*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t*t*t*p3[1]
        pts.append((x, y))
    return pts


def pt_in_poly(x, y, poly):
    inside = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def icon(size):
    """Render smooth anti-aliased NEXAR PWA icon matching brand/icons/icon.svg."""
    s = size / 512.0
    # Transform SVG path coordinates (translate(86, 112) scale(2.83)) directly to 512x512 canvas
    T = lambda x, y: (86.0 + x * 2.83, 112.0 + y * 2.83)
    # Left back stem: M12 86 V34 C12 18 22 10 34 10 h2 L36 69 12 86 Z
    left_poly = [T(12, 86), T(12, 34)] + [T(*p) for p in cubic((12, 34), (12, 18), (22, 10), (34, 10), 32)] + [T(36, 10), T(36, 69)]
    # Right back stem: M84 27 L108 10 v52 c0 16-10 24-22 24 h-2 V27 Z
    right_poly = [T(84, 27), T(108, 10), T(108, 62)] + [T(*p) for p in cubic((108, 62), (108, 78), (98, 86), (86, 86), 32)] + [T(84, 86)]
    # Front diagonal ribbon: M24 14 C30 9 39 10 47 16 L96 66 C101 71 100 80 93 84 C86 88 78 86 72 80 L24 30 C18 24 18 18 24 14 Z
    diag_poly = (
        [T(*p) for p in cubic((24, 14), (30, 9), (39, 10), (47, 16), 24)]
        + [T(96, 66)]
        + [T(*p) for p in cubic((96, 66), (101, 71), (100, 80), (93, 84), 24)]
        + [T(*p) for p in cubic((93, 84), (86, 88), (78, 86), (72, 80), 24)]
        + [T(24, 30)]
        + [T(*p) for p in cubic((24, 30), (18, 24), (18, 18), (24, 14), 24)]
    )
    brackets = [
        ((84, 134), (84, 88)), ((88, 84), (134, 84)),
        ((378, 84), (424, 84)), ((428, 88), (428, 134)),
        ((428, 378), (428, 424)), ((424, 428), (378, 428)),
        ((134, 428), (88, 428)), ((84, 424), (84, 378)),
    ]

    def sample(X, Y):
        r = 112.0
        cx = min(max(X, r), 512.0 - r); cy = min(max(Y, r), 512.0 - r)
        if math.hypot(X - cx, Y - cy) > r:
            return (0, 0, 0, 0)
        t = min(1.0, math.hypot(X - 256.0, Y - 102.0) / 440.0)
        bg = 25.0 + (6.0 - 25.0) * t
        col = [bg, bg, bg + 2.0]
        # NEXAR Site Yellow (#F5C518) AR corner viewfinder brackets
        if (X < 146 or X > 366) and (Y < 146 or Y > 366):
            bd = min(seg_dist(X, Y, a[0], a[1], b[0], b[1]) for a, b in brackets)
            if bd < 5.0:
                col = [245.0, 197.0, 24.0]
        # ribbon N bounding box shortcut for fast supersampling
        if 114.0 <= X <= 398.0 and 136.0 <= Y <= 366.0:
            if pt_in_poly(X, Y, left_poly):
                gy = max(0.0, min(1.0, (Y - 140.0) / 215.0))
                v = 152.0 + 78.0 * (1.0 - abs(gy - 0.55) * 1.45)
                col = [v, v, min(255.0, v + 4.0)]
            if pt_in_poly(X, Y, right_poly):
                gy = max(0.0, min(1.0, (Y - 140.0) / 215.0))
                v = 148.0 + 80.0 * (1.0 - abs(gy - 0.45) * 1.45)
                col = [v, v, min(255.0, v + 4.0)]
            if pt_in_poly(X, Y, diag_poly):
                gd = max(0.0, min(1.0, (X - 142.0 + Y - 140.0) / 420.0))
                v = 255.0 - 28.0 * gd
                col = [v, v, min(255.0, v + 3.0)]
        return (col[0], col[1], col[2], 255.0)

    def px(x, y):
        # 2x2 supersampling for crisp anti-aliased edges
        r0 = g0 = b0 = a0 = 0.0
        for ox, oy in ((0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)):
            cr, cg, cb, ca = sample((x + ox) / s, (y + oy) / s)
            r0 += cr * ca; g0 += cg * ca; b0 += cb * ca; a0 += ca
        if a0 <= 0.0:
            return (0, 0, 0, 0)
        return (int(r0 / a0 + 0.5), int(g0 / a0 + 0.5), int(b0 / a0 + 0.5), int(a0 / 4.0 + 0.5))
    return px


# ----------------------------------------------------------------- IFC sample
CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'


def guid():
    return random.choice('0123') + ''.join(random.choice(CHARS) for _ in range(21))


def make_ifc(path):
    random.seed(7)
    L = []
    n = [0]

    def add(s):
        n[0] += 1
        L.append(f'#{n[0]}={s};')
        return f'#{n[0]}'

    def f(v):
        return f'{float(v):.4f}'.rstrip('0').rstrip('.') + '.' if float(v).is_integer() else f'{float(v):.4f}'

    origin = add('IFCCARTESIANPOINT((0.,0.,0.))')
    zdir = add('IFCDIRECTION((0.,0.,1.))')
    xdir = add('IFCDIRECTION((1.,0.,0.))')
    wcs = add(f'IFCAXIS2PLACEMENT3D({origin},{zdir},{xdir})')
    north = add('IFCDIRECTION((0.2588190451,0.9659258263))')  # project north rotated 15 deg from true north
    ctx = add(f"IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,{wcs},{north})")
    body = add(f"IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,{ctx},$,.MODEL_VIEW.,$)")
    u1 = add('IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')
    u2 = add('IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)')
    u3 = add('IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)')
    u4 = add('IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)')
    units = add(f'IFCUNITASSIGNMENT(({u1},{u2},{u3},{u4}))')
    proj = add(f"IFCPROJECT('{guid()}',$,'NEXAR Sample Building',$,$,$,$,({ctx}),{units})")
    site_pl = add(f'IFCLOCALPLACEMENT($,{wcs})')
    site = add(f"IFCSITE('{guid()}',$,'Site',$,$,{site_pl},$,$,.ELEMENT.,(13,44,10,0),(100,31,30,0),0.,$,$)")
    bld_pl = add(f'IFCLOCALPLACEMENT({site_pl},{wcs})')
    bld = add(f"IFCBUILDING('{guid()}',$,'Building A',$,$,{bld_pl},$,$,.ELEMENT.,$,$,$)")
    add(f"IFCRELAGGREGATES('{guid()}',$,$,$,{proj},({site}))")
    add(f"IFCRELAGGREGATES('{guid()}',$,$,$,{site},({bld}))")

    styles = {}

    def style(name, r, g, b, transp=0.0):
        if name in styles:
            return styles[name]
        c = add(f"IFCCOLOURRGB($,{r},{g},{b})")
        sh = add(f'IFCSURFACESTYLESHADING({c},{transp})')
        st = add(f"IFCSURFACESTYLE('{name}',.BOTH.,({sh}))")
        styles[name] = st
        return st

    def box(storey_pl, x, y, z, lx, ly, h, sty, angle=0.0):
        p = add(f'IFCCARTESIANPOINT(({f(x)},{f(y)},{f(z)}))')
        rd = add(f'IFCDIRECTION(({math.cos(angle):.6f},{math.sin(angle):.6f},0.))')
        a3 = add(f'IFCAXIS2PLACEMENT3D({p},{zdir},{rd})')
        lp = add(f'IFCLOCALPLACEMENT({storey_pl},{a3})')
        p2 = add('IFCCARTESIANPOINT((0.,0.))')
        a2 = add(f'IFCAXIS2PLACEMENT2D({p2},$)')
        prof = add(f'IFCRECTANGLEPROFILEDEF(.AREA.,$,{a2},{f(lx)},{f(ly)})')
        solid = add(f'IFCEXTRUDEDAREASOLID({prof},{wcs},{zdir},{f(h)})')
        add(f'IFCSTYLEDITEM({solid},({sty}),$)')
        rep = add(f"IFCSHAPEREPRESENTATION({body},'Body','SweptSolid',({solid}))")
        pds = add(f'IFCPRODUCTDEFINITIONSHAPE($,$,({rep}))')
        return lp, pds

    wall_s = style('Concrete wall', 0.86, 0.87, 0.88)
    slab_s = style('Slab', 0.62, 0.65, 0.70)
    col_s = style('Column', 0.48, 0.55, 0.66)
    glass_s = style('Glass', 0.55, 0.80, 0.95, 0.6)
    proxy_s = style('Equipment', 0.95, 0.62, 0.25)

    W, D, H = 24.0, 14.0, 3.5
    storeys = []
    for lvl in range(2):
        elev = lvl * H
        pl_pt = add(f'IFCCARTESIANPOINT((0.,0.,{f(elev)}))')
        pl_ax = add(f'IFCAXIS2PLACEMENT3D({pl_pt},$,$)')
        st_pl = add(f'IFCLOCALPLACEMENT({bld_pl},{pl_ax})')
        st = add(f"IFCBUILDINGSTOREY('{guid()}',$,'Level {lvl + 1}',$,$,{st_pl},$,$,.ELEMENT.,{f(elev)})")
        storeys.append(st)
        elems = []
        t = 0.25
        # slab
        lp, pds = box(st_pl, W / 2, D / 2, -0.2, W, D, 0.2, slab_s)
        elems.append(add(f"IFCSLAB('{guid()}',$,'Floor slab L{lvl + 1}',$,$,{lp},{pds},'SL-{lvl + 1}',.FLOOR.)"))
        # outer walls (with window strips on the long sides)
        walls = [(W / 2, t / 2, W, t, 'South'), (W / 2, D - t / 2, W, t, 'North'), (t / 2, D / 2, t, D - 2 * t, 'West'), (W - t / 2, D / 2, t, D - 2 * t, 'East')]
        for i, (x, y, lx, ly, nm) in enumerate(walls):
            hh = 1.0 if nm in ('South', 'North') else H - 0.2
            lp, pds = box(st_pl, x, y, 0, lx, ly, hh, wall_s)
            elems.append(add(f"IFCWALL('{guid()}',$,'Wall {nm} L{lvl + 1}',$,'Basic Wall:Exterior 250',{lp},{pds},'W{lvl + 1}{i}',.STANDARD.)"))
            if nm in ('South', 'North'):
                lp, pds = box(st_pl, x, y, 1.0, lx, 0.06, 1.8, glass_s)
                elems.append(add(f"IFCPLATE('{guid()}',$,'Curtain glazing {nm} L{lvl + 1}',$,$,{lp},{pds},$,.CURTAIN_PANEL.)"))
                lp, pds = box(st_pl, x, y, 2.8, lx, ly, H - 0.2 - 2.8, wall_s)
                elems.append(add(f"IFCWALL('{guid()}',$,'Spandrel {nm} L{lvl + 1}',$,$,{lp},{pds},$,.STANDARD.)"))
        # interior walls
        lp, pds = box(st_pl, 9.0, 5.0, 0, 0.15, 10.0 - 2 * t, H - 0.2, wall_s)
        elems.append(add(f"IFCWALL('{guid()}',$,'Partition A L{lvl + 1}',$,'Basic Wall:Interior 150',{lp},{pds},$,.PARTITIONING.)"))
        lp, pds = box(st_pl, 16.5, 9.0, 0, 15.0, 0.15, H - 0.2, wall_s)
        elems.append(add(f"IFCWALL('{guid()}',$,'Partition B L{lvl + 1}',$,'Basic Wall:Interior 150',{lp},{pds},$,.PARTITIONING.)"))
        # columns on a 6 m grid
        for gx in range(0, 5):
            for gy in range(0, 3):
                cx, cy = 0.6 + gx * (W - 1.2) / 4, 0.6 + gy * (D - 1.2) / 2
                lp, pds = box(st_pl, cx, cy, 0, 0.4, 0.4, H - 0.2, col_s)
                elems.append(add(f"IFCCOLUMN('{guid()}',$,'Column {chr(65 + gy)}{gx + 1} L{lvl + 1}',$,'Concrete-Rectangular 400x400',{lp},{pds},'C{chr(65 + gy)}{gx + 1}',.COLUMN.)"))
        # equipment
        if lvl == 0:
            lp, pds = box(st_pl, 20.5, 3.0, 0, 2.0, 1.2, 1.8, proxy_s)
            elems.append(add(f"IFCBUILDINGELEMENTPROXY('{guid()}',$,'AHU-01',$,'Air handling unit',{lp},{pds},'AHU-01',.ELEMENT.)"))
        add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{guid()}',$,$,$,({','.join(elems)}),{st})")
    # roof slab
    pl_pt = add(f'IFCCARTESIANPOINT((0.,0.,{f(2 * H)}))')
    pl_ax = add(f'IFCAXIS2PLACEMENT3D({pl_pt},$,$)')
    rf_pl = add(f'IFCLOCALPLACEMENT({bld_pl},{pl_ax})')
    rf = add(f"IFCBUILDINGSTOREY('{guid()}',$,'Roof',$,$,{rf_pl},$,$,.ELEMENT.,{f(2 * H)})")
    storeys.append(rf)
    lp, pds = box(rf_pl, W / 2, D / 2, -0.2, W, D, 0.25, slab_s)
    roof = add(f"IFCSLAB('{guid()}',$,'Roof slab',$,$,{lp},{pds},'RF',.ROOF.)")
    add(f"IFCRELCONTAINEDINSPATIALSTRUCTURE('{guid()}',$,$,$,({roof}),{rf})")
    add(f"IFCRELAGGREGATES('{guid()}',$,$,$,{bld},({','.join(storeys)}))")

    head = ("ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');\n"
            "FILE_NAME('sample-building.ifc','2026-11-23T09:00:00',('NEXAR'),('NEXAR'),'NEXAR generator','NEXAR','');\n"
            "FILE_SCHEMA(('IFC4'));\nENDSEC;\nDATA;\n")
    with open(path, 'w', encoding='ascii', newline='\n') as fh:
        fh.write(head + '\n'.join(L) + '\nENDSEC;\nEND-ISO-10303-21;\n')


if __name__ == '__main__':
    for sz in (192, 512):
        write_png(os.path.join(ROOT, 'brand', 'icons', f'icon-{sz}.png'), sz, sz, icon(sz))
    make_ifc(os.path.join(ROOT, 'samples', 'sample-building.ifc'))
    print('icons + sample IFC written')
