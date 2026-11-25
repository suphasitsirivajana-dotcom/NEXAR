// Complete ASTM E1557 UniFormat II Classification (Level 1 → Level 2 → Level 3)
// Mapped to Revit Built-in Categories & Assembly Codes for Site-to-BIM Family Automation.

export const UNIFORMAT_L1 = [
  { code: 'A', name: 'Substructure' },
  { code: 'B', name: 'Shell' },
  { code: 'C', name: 'Interiors' },
  { code: 'D', name: 'Services' },
  { code: 'E', name: 'Equipment & Furnishings' },
  { code: 'F', name: 'Special Construction' },
  { code: 'G', name: 'Building Sitework' }
];

export const UNIFORMAT_L2 = [
  { code: 'A10', group: 'A', name: 'Foundations' },
  { code: 'A20', group: 'A', name: 'Basement Construction' },
  { code: 'B10', group: 'B', name: 'Superstructure' },
  { code: 'B20', group: 'B', name: 'Exterior Enclosure' },
  { code: 'B30', group: 'B', name: 'Roofing' },
  { code: 'C10', group: 'C', name: 'Interior Construction' },
  { code: 'C20', group: 'C', name: 'Stairs' },
  { code: 'C30', group: 'C', name: 'Interior Finishes' },
  { code: 'D10', group: 'D', name: 'Conveying' },
  { code: 'D20', group: 'D', name: 'Plumbing' },
  { code: 'D30', group: 'D', name: 'HVAC' },
  { code: 'D40', group: 'D', name: 'Fire Protection' },
  { code: 'D50', group: 'D', name: 'Electrical & ICT' },
  { code: 'E10', group: 'E', name: 'Equipment' },
  { code: 'E20', group: 'E', name: 'Furnishings' },
  { code: 'F10', group: 'F', name: 'Special Construction' },
  { code: 'F20', group: 'F', name: 'Selective Demolition' },
  { code: 'G10', group: 'G', name: 'Site Preparation' },
  { code: 'G20', group: 'G', name: 'Site Improvements' },
  { code: 'G30', group: 'G', name: 'Site Mechanical Utilities' },
  { code: 'G40', group: 'G', name: 'Site Electrical Utilities' },
  { code: 'G90', group: 'G', name: 'Other Site Construction' }
];

// [id, uniformatL3, l3Name, revitCategory, familyName, typeName, placement, offsetZ, pinned]
const RAW = [
  // A — Substructure
  ['a1010-std',   'A1010', 'Standard Foundations',            'Structural Foundations',     'Footing',            'Standard',          'level-based', 0,    false],
  ['a1020-pile',  'A1020', 'Special Foundations',             'Structural Foundations',     'Pile_Foundation',    'Bored Pile',        'level-based', 0,    false],
  ['a1030-sog',   'A1030', 'Slab on Grade',                   'Floors',                     'Slab_On_Grade',      'SOG',               'face-based',  0,    false],
  ['a2010-exc',   'A2010', 'Basement Excavation',             'Site',                       'Excavation_Mark',    'Check Point',       'level-based', 0,    false],
  ['a2020-bwall', 'A2020', 'Basement Walls',                  'Walls',                      'Retaining_Wall',     'Basement',          'face-based',  0,    false],

  // B — Shell
  ['b1010-slv',   'B1010', 'Floor Construction (Opening)',    'Generic Models',             'MEP_Opening',        'Sleeve 150',        'face-based',  0,    true],
  ['b1010-col',   'B1010', 'Floor Construction (Structure)',  'Structural Columns',         'Struct_Check',       'Column / Beam',     'face-based',  0,    false],
  ['b1020-roof',  'B1020', 'Roof Construction',               'Roofs',                      'Roof_Structure',     'Roof Framing',      'face-based',  0,    false],
  ['b2010-ewall', 'B2010', 'Exterior Walls',                  'Walls',                      'Exterior_Wall',      'Facade / Cladding', 'face-based',  0,    false],
  ['b2020-win',   'B2020', 'Exterior Windows',                'Windows',                    'Exterior_Window',    'Fixed / Casement',  'face-based',  0.9,  false],
  ['b2030-edoor', 'B2030', 'Exterior Doors',                  'Doors',                      'Exterior_Door',      'Double Entry',      'face-based',  0,    false],
  ['b3010-rcov',  'B3010', 'Roof Coverings',                  'Roofs',                      'Roof_Waterproof',    'Membrane',          'face-based',  0,    false],
  ['b3020-ropen', 'B3020', 'Roof Openings',                   'Specialty Equipment',        'Roof_Hatch',         'Access / Skylight', 'face-based',  0,    false],

  // C — Interiors
  ['c1010-part',  'C1010', 'Partitions',                      'Walls',                      'Interior_Partition', 'Gypsum / Masonry',  'face-based',  0,    false],
  ['c1020-idoor', 'C1020', 'Interior Doors',                  'Doors',                      'Single_Door',        '900x2100',          'face-based',  0,    false],
  ['c1030-fit',   'C1030', 'Fittings',                        'Specialty Equipment',        'Interior_Fitting',   'Toilet / Grab Bar', 'face-based',  0.85, false],
  ['c2010-stair', 'C2010', 'Stair Construction',              'Stairs',                     'Stair_Check',        'RC / Steel',        'face-based',  0,    false],
  ['c2020-sfin',  'C2020', 'Stair Finishes',                  'Railings',                   'Handrail',           'Wall Mounted',      'face-based',  0.9,  false],
  ['c3010-wfin',  'C3010', 'Wall Finishes',                   'Walls',                      'Wall_Finish',        'Paint / Tile',      'face-based',  0,    false],
  ['c3020-ffin',  'C3020', 'Floor Finishes',                  'Floors',                     'Floor_Finish',       'Tile / Epoxy',      'face-based',  0,    false],
  ['c3030-cfin',  'C3030', 'Ceiling Finishes',                'Ceilings',                   'Ceiling_Access',     'Access Panel',      'face-based',  0,    false],

  // D — Services (MEP & Smart Building / ICT)
  ['d1010-elev',  'D1010', 'Elevators & Lifts',               'Specialty Equipment',        'Elevator_Call',      'Hall Button',       'face-based',  1.1,  false],
  ['d1020-esc',   'D1020', 'Escalators & Moving Walks',       'Specialty Equipment',        'Escalator_Check',    'Landing',           'level-based', 0,    false],
  ['d1090-conv',  'D1090', 'Other Conveying Systems',         'Specialty Equipment',        'Pneumatic_Tube',     'Station',           'face-based',  1.2,  false],

  ['d2010-fix',   'D2010', 'Plumbing Fixtures',               'Plumbing Fixtures',          'Plumbing_Fixture',   'WC / Basin',        'face-based',  0,    false],
  ['d2020-water', 'D2020', 'Domestic Water Distribution',     'Pipe Accessories',           'Water_Valve',        'Isolation Valve',   'face-based',  0,    false],
  ['d2030-drain', 'D2030', 'Sanitary Waste',                  'Plumbing Fixtures',          'Floor_Drain',        'FD-100',            'face-based',  0,    false],
  ['d2040-rain',  'D2040', 'Rain Water Drainage',             'Plumbing Fixtures',          'Roof_Drain',         'RD-100',            'face-based',  0,    false],
  ['d2090-med',   'D2090', 'Other Plumbing (Medical Gas)',    'Plumbing Fixtures',          'MedGas_Outlet',      'O2 / Vac',          'face-based',  1.4,  false],

  ['d3010-esup',  'D3010', 'Energy Supply',                   'Mechanical Equipment',       'Energy_Meter',       'Utility Supply',    'face-based',  1.5,  false],
  ['d3020-heat',  'D3020', 'Heat Generating Systems',         'Mechanical Equipment',       'Heat_Pump',          'Boiler / Heater',   'level-based', 0,    false],
  ['d3030-cool',  'D3030', 'Cooling Generating Systems',      'Mechanical Equipment',       'Chiller_Unit',       'Chiller / CDU',     'level-based', 0,    false],
  ['d3040-diff',  'D3040', 'Distribution Systems (Diffuser)', 'Air Terminals',              'Supply_Diffuser',    '600x600',           'face-based',  0,    true],
  ['d3050-fcu',   'D3050', 'Terminal & Package Units',        'Mechanical Equipment',       'FCU_Split',          'Ceiling / Wall',    'face-based',  0,    false],
  ['d3060-stat',  'D3060', 'Controls & Instrumentation',      'Mechanical Control Devices', 'Thermostat',         'Wall Sensor',       'face-based',  1.4,  false],
  ['d3070-tab',   'D3070', 'Systems Testing & Balancing',     'Duct Accessories',           'Volume_Damper',      'TAB Test Port',     'face-based',  0,    false],
  ['d3090-hvac',  'D3090', 'Other HVAC Systems',              'Mechanical Equipment',       'Exhaust_Fan',        'Ventilation',       'face-based',  0,    false],

  ['d4010-sprk',  'D4010', 'Sprinklers',                      'Sprinklers',                 'Sprinkler',          'Pendent',           'face-based',  0,    true],
  ['d4020-fhc',   'D4020', 'Standpipes (Fire Hose)',          'Pipe Accessories',           'Fire_Hose_Cabinet',  'FHC Recessed',      'face-based',  0.9,  false],
  ['d4030-ext',   'D4030', 'Fire Protection Specialties',     'Specialty Equipment',        'Fire_Extinguisher',  '10 lb Wall',        'face-based',  1.1,  false],
  ['d4090-smk',   'D4090', 'Other Fire Protection (Alarm)',   'Fire Alarm Devices',         'Smoke_Detector',     'Optical',           'face-based',  0,    false],

  ['d5010-mdb',   'D5010', 'Electrical Service & Distribution', 'Electrical Equipment',     'Panelboard',         'LP / DB Panel',     'face-based',  1.5,  false],
  ['d5020-out',   'D5020', 'Branch Wiring (Power Outlet)',    'Electrical Fixtures',        'Power_Outlet',       'Duplex 220V',       'face-based',  0.30, true],
  ['d5020-sw',    'D5020', 'Branch Wiring (Light Switch)',    'Lighting Devices',           'Light_Switch',       '1-Gang',            'face-based',  1.20, true],
  ['d5020-lgt',   'D5020', 'Lighting Fixtures',               'Lighting Fixtures',          'Downlight',          'LED 12W',           'face-based',  0,    false],
  ['d5030-cctv',  'D5030', 'Communications & Security (CCTV)', 'Security Devices',          'CCTV_Camera',        'Dome',              'face-based',  0,    true],
  ['d5030-wifi',  'D5030', 'Communications (Wi-Fi AP)',       'Data Devices',               'WiFi_AP',            'Ceiling Mount',     'face-based',  0,    true],
  ['d5030-acs',   'D5030', 'Security (Access Control)',       'Security Devices',           'Access_Reader',      'Card Reader',       'face-based',  1.20, false],
  ['d5030-data',  'D5030', 'Communications (Data Outlet)',    'Data Devices',               'Data_Outlet',        'RJ45 Cat6A',        'face-based',  0.30, false],
  ['d5090-emg',   'D5090', 'Other Electrical (Emergency/UPS)', 'Lighting Fixtures',         'Exit_Sign',          'Emergency LED',     'face-based',  2.20, false],

  // E — Equipment & Furnishings
  ['e1010-com',   'E1010', 'Commercial Equipment',            'Specialty Equipment',        'Commercial_Equip',   'Kitchen / AV',      'level-based', 0,    false],
  ['e1020-inst',  'E1020', 'Institutional Equipment',         'Specialty Equipment',        'Medical_Equip',      'Hospital / Lab',    'level-based', 0,    false],
  ['e1030-veh',   'E1030', 'Vehicular Equipment',             'Specialty Equipment',        'EV_Charger',         'Wallbox 22kW',      'face-based',  1.20, false],
  ['e1090-oth',   'E1090', 'Other Equipment',                 'Specialty Equipment',        'Special_Equip',      'General',           'level-based', 0,    false],
  ['e2010-fix',   'E2010', 'Fixed Furnishings & Signage',     'Casework',                   'Signage',            'Wall Mount',        'face-based',  1.50, false],
  ['e2020-mov',   'E2020', 'Movable Furnishings',             'Furniture',                  'Workstation',        'Desk / Chair',      'level-based', 0,    false],

  // F — Special Construction & Demolition
  ['f1010-str',   'F1010', 'Special Structures',              'Generic Models',             'Special_Structure',  'Canopy / Vault',    'level-based', 0,    false],
  ['f1020-int',   'F1020', 'Integrated Construction',         'Generic Models',             'Cleanroom_Panel',    'Modular Room',      'face-based',  0,    false],
  ['f1030-sys',   'F1030', 'Special Construction Systems',    'Generic Models',             'Acoustic_Panel',     'Wall Baffle',       'face-based',  0,    false],
  ['f1040-fac',   'F1040', 'Special Facilities',              'Generic Models',             'Special_Facility',   'Pool / Tank',       'level-based', 0,    false],
  ['f1050-iot',   'F1050', 'Special Controls (BMS / IoT)',    'Specialty Equipment',        'IoT_Sensor',         'IAQ / Occupancy',   'face-based',  0,    false],
  ['f2010-demo',  'F2010', 'Building Elements Demolition',    'Generic Models',             'Demo_Marker',        'Hacking / Remove',  'face-based',  0,    false],
  ['f2020-haz',   'F2020', 'Hazardous Components Abatement',  'Generic Models',             'Hazmat_Marker',      'Abatement Zone',    'face-based',  0,    false],

  // G — Building Sitework
  ['g1010-clr',   'G1010', 'Site Clearing',                   'Site',                       'Site_Clearing',      'Boundary',          'level-based', 0,    false],
  ['g1020-sdem',  'G1020', 'Site Demolition & Relocations',   'Site',                       'Site_Relocate',      'Utility Reloc',     'level-based', 0,    false],
  ['g1030-erth',  'G1030', 'Site Earthwork',                  'Topography',                 'Grading_Point',      'Elevation Spot',    'level-based', 0,    false],
  ['g1040-rem',   'G1040', 'Hazardous Waste Remediation',     'Site',                       'Site_Remediation',   'Sampling Point',    'level-based', 0,    false],
  ['g2010-road',  'G2010', 'Roadways',                        'Site',                       'Road_Marker',        'Curb / Marking',    'face-based',  0,    false],
  ['g2020-park',  'G2020', 'Parking Lots',                    'Parking',                    'Parking_Stop',       'Wheel Stop',        'face-based',  0,    false],
  ['g2030-pave',  'G2030', 'Pedestrian Paving',               'Site',                       'Paving_Detail',      'Tactile / Ramp',    'face-based',  0,    false],
  ['g2040-sdev',  'G2040', 'Site Development',                'Site',                       'Bollard_Sign',       'Bollard / Fence',   'level-based', 0,    false],
  ['g2050-land',  'G2050', 'Landscaping',                     'Planting',                   'Tree_Planter',       'Tree / Swale',      'level-based', 0,    false],
  ['g3010-swat',  'G3010', 'Site Water Supply',               'Plumbing Fixtures',          'Fire_Hydrant',       'Outdoor Hydrant',   'level-based', 0,    false],
  ['g3020-ssan',  'G3020', 'Sanitary Sewer',                  'Plumbing Fixtures',          'Sanitary_Manhole',   'MH-SAN',            'level-based', 0,    false],
  ['g3030-sstm',  'G3030', 'Storm Sewer',                     'Plumbing Fixtures',          'Catch_Basin',        'Drainage Pit',      'level-based', 0,    false],
  ['g3040-sht',   'G3040', 'Site Heating Distribution',       'Mechanical Equipment',       'Site_Heat_Pit',      'Valve Pit',         'level-based', 0,    false],
  ['g3050-scl',   'G3050', 'Site Cooling Distribution',       'Mechanical Equipment',       'District_Cooling',   'Valve Chamber',     'level-based', 0,    false],
  ['g3060-sfuel', 'G3060', 'Site Fuel Distribution',          'Mechanical Equipment',       'Fuel_Tank_Port',     'Fill / Vent',       'level-based', 0,    false],
  ['g3090-smech', 'G3090', 'Other Site Mechanical',           'Mechanical Equipment',       'Site_Pump',          'Pump Pit',          'level-based', 0,    false],
  ['g4010-sel',   'G4010', 'Site Electrical Distribution',    'Electrical Equipment',       'Handhole_EL',        'Pull Box / Pole',   'level-based', 0,    false],
  ['g4020-slgt',  'G4020', 'Site Lighting',                   'Lighting Fixtures',          'Site_Pole_Light',    'LED Bollard/Pole',  'level-based', 0,    false],
  ['g4030-scom',  'G4030', 'Site Communications & Security',  'Security Devices',           'Perimeter_CCTV',     'Pole Bullet',       'face-based',  0,    false],
  ['g4090-soth',  'G4090', 'Other Site Electrical',           'Electrical Equipment',       'Ground_Pit',         'Earthing Pit',      'level-based', 0,    false],
  ['g9010-tun',   'G9010', 'Service & Pedestrian Tunnels',    'Generic Models',             'Tunnel_Marker',      'Utility Tunnel',    'face-based',  0,    false],
  ['g9090-soth',  'G9090', 'Other Site Systems',              'Generic Models',             'Site_General',       'Site Reference',    'level-based', 0,    false]
];

export const UNIFORMAT_CATALOG = RAW.map(([id, uniformat, l3Name, category, familyName, typeName, placement, offsetZ, pinned]) => ({
  id,
  uniformat,
  l2: uniformat.slice(0, 3),
  group: uniformat[0],
  l3Name,
  category,
  familyName,
  typeName,
  placement,
  offsetZ,
  pinned
}));
