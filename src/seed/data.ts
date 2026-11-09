import type { ItemKind } from '@/modules/inventory/types'
import type { Role } from '@/core/permissions/roles'

/**
 * Datos 100 % ficticios para la demostración. Las contraseñas son públicas a propósito
 * (aparecen en el README y en la pantalla de acceso); no corresponden a ninguna cuenta real.
 */
export interface DemoAccount {
  id: string
  name: string
  email: string
  password: string
  role: Role
  area: string
  status?: 'active' | 'disabled'
}

export const DEMO_ADMIN_PASSWORD = 'Admin2026!'
export const DEMO_USER_PASSWORD = 'Usuario2026!'

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'u-admin', name: 'Laura Mendoza', email: 'admin@steam.demo', password: DEMO_ADMIN_PASSWORD, role: 'admin', area: 'Coordinación Sala STEAM' },
  { id: 'u-sofia', name: 'Sofía Ramírez', email: 'usuario@steam.demo', password: DEMO_USER_PASSWORD, role: 'user', area: 'Docente de Tecnología' },
  { id: 'u-andres', name: 'Andrés Torres', email: 'andres@steam.demo', password: DEMO_USER_PASSWORD, role: 'user', area: 'Grado 10-A' },
  { id: 'u-valentina', name: 'Valentina Gómez', email: 'valentina@steam.demo', password: DEMO_USER_PASSWORD, role: 'user', area: 'Grado 11-B' },
  { id: 'u-mateo', name: 'Mateo Herrera', email: 'mateo@steam.demo', password: DEMO_USER_PASSWORD, role: 'user', area: 'Club de Robótica' },
  { id: 'u-camila', name: 'Camila Díaz', email: 'camila@steam.demo', password: DEMO_USER_PASSWORD, role: 'user', area: 'Docente de Ciencias' },
  { id: 'u-exalumno', name: 'Julián Pardo', email: 'exalumno@steam.demo', password: DEMO_USER_PASSWORD, role: 'user', area: 'Egresado', status: 'disabled' },
]

export const CATEGORY_NAMES = ['Electrónica', 'Robótica', 'Impresión 3D', 'Herramientas', 'Seguridad', 'Papelería y maker']

export interface SeedItem {
  sku: string
  name: string
  category: string
  kind: ItemKind
  unit: string
  stock: number
  min: number
  location: string
  cost: number
}

export const SEED_ITEMS: SeedItem[] = [
  { sku: 'ELE-ARD-UNO', name: 'Arduino UNO R3', category: 'Electrónica', kind: 'equipment', unit: 'ud', stock: 14, min: 4, location: 'Estante A1', cost: 12 },
  { sku: 'ELE-MBIT', name: 'micro:bit v2', category: 'Electrónica', kind: 'equipment', unit: 'ud', stock: 12, min: 4, location: 'Estante A1', cost: 20 },
  { sku: 'ELE-RPI4', name: 'Raspberry Pi 4 (4 GB)', category: 'Electrónica', kind: 'equipment', unit: 'ud', stock: 5, min: 2, location: 'Armario B', cost: 55 },
  { sku: 'ELE-BRD', name: 'Protoboard 830 puntos', category: 'Electrónica', kind: 'equipment', unit: 'ud', stock: 20, min: 6, location: 'Estante A2', cost: 4 },
  { sku: 'ELE-US', name: 'Sensor ultrasónico HC-SR04', category: 'Electrónica', kind: 'consumable', unit: 'ud', stock: 18, min: 5, location: 'Estante A2', cost: 3 },
  { sku: 'ELE-SERVO', name: 'Servomotor SG90', category: 'Electrónica', kind: 'consumable', unit: 'ud', stock: 24, min: 8, location: 'Estante A2', cost: 3.5 },
  { sku: 'ELE-LED', name: 'LED 5 mm surtidos', category: 'Electrónica', kind: 'consumable', unit: 'ud', stock: 400, min: 100, location: 'Cajón C1', cost: 0.1 },
  { sku: 'ELE-RES', name: 'Resistencias surtidas', category: 'Electrónica', kind: 'consumable', unit: 'ud', stock: 600, min: 200, location: 'Cajón C1', cost: 0.05 },
  { sku: 'ELE-JMP', name: 'Cables jumper', category: 'Electrónica', kind: 'consumable', unit: 'ud', stock: 300, min: 80, location: 'Cajón C2', cost: 0.08 },
  { sku: 'ROB-MOT', name: 'Motor DC con reductora', category: 'Robótica', kind: 'consumable', unit: 'ud', stock: 30, min: 10, location: 'Estante D1', cost: 2.5 },
  { sku: 'ROB-WHL', name: 'Ruedas para robot', category: 'Robótica', kind: 'consumable', unit: 'ud', stock: 40, min: 10, location: 'Estante D1', cost: 1.2 },
  { sku: 'ROB-SPIKE', name: 'Kit LEGO SPIKE Prime', category: 'Robótica', kind: 'equipment', unit: 'kit', stock: 8, min: 2, location: 'Armario B', cost: 280 },
  { sku: '3D-PLA-BLN', name: 'Filamento PLA blanco 1.75 mm', category: 'Impresión 3D', kind: 'filament', unit: 'g', stock: 6000, min: 1500, location: 'Estante E1', cost: 0.022 },
  { sku: '3D-PLA-NGR', name: 'Filamento PLA negro 1.75 mm', category: 'Impresión 3D', kind: 'filament', unit: 'g', stock: 5000, min: 1500, location: 'Estante E1', cost: 0.022 },
  { sku: '3D-PLA-AZL', name: 'Filamento PLA azul 1.75 mm', category: 'Impresión 3D', kind: 'filament', unit: 'g', stock: 3000, min: 1000, location: 'Estante E1', cost: 0.022 },
  { sku: '3D-PETG-TRA', name: 'Filamento PETG transparente', category: 'Impresión 3D', kind: 'filament', unit: 'g', stock: 2500, min: 1000, location: 'Estante E1', cost: 0.028 },
  { sku: '3D-NOZ', name: 'Boquilla 0.4 mm (repuesto)', category: 'Impresión 3D', kind: 'consumable', unit: 'ud', stock: 15, min: 5, location: 'Cajón E2', cost: 2.5 },
  { sku: '3D-BED', name: 'Lámina de cama PEI', category: 'Impresión 3D', kind: 'consumable', unit: 'ud', stock: 6, min: 2, location: 'Cajón E2', cost: 18 },
  { sku: '3D-BELT', name: 'Correa GT2 (repuesto)', category: 'Impresión 3D', kind: 'consumable', unit: 'ud', stock: 8, min: 3, location: 'Cajón E2', cost: 6 },
  { sku: 'HER-SOLD', name: 'Cautín 60 W', category: 'Herramientas', kind: 'tool', unit: 'ud', stock: 8, min: 3, location: 'Panel F', cost: 15 },
  { sku: 'HER-MULT', name: 'Multímetro digital', category: 'Herramientas', kind: 'tool', unit: 'ud', stock: 10, min: 3, location: 'Panel F', cost: 18 },
  { sku: 'HER-GLUE', name: 'Pistola de silicona', category: 'Herramientas', kind: 'tool', unit: 'ud', stock: 6, min: 2, location: 'Panel F', cost: 9 },
  { sku: 'HER-CUT', name: 'Alicate de corte', category: 'Herramientas', kind: 'tool', unit: 'ud', stock: 10, min: 3, location: 'Panel F', cost: 6 },
  { sku: 'HER-STRIP', name: 'Pelacables', category: 'Herramientas', kind: 'tool', unit: 'ud', stock: 5, min: 2, location: 'Panel F', cost: 8 },
  { sku: 'HER-SIL', name: 'Barras de silicona caliente', category: 'Herramientas', kind: 'consumable', unit: 'ud', stock: 120, min: 40, location: 'Cajón G1', cost: 0.3 },
  { sku: 'SEG-GAF', name: 'Gafas de seguridad', category: 'Seguridad', kind: 'equipment', unit: 'ud', stock: 25, min: 8, location: 'Armario H', cost: 3 },
  { sku: 'SEG-GLV', name: 'Guantes de protección', category: 'Seguridad', kind: 'consumable', unit: 'par', stock: 40, min: 12, location: 'Armario H', cost: 1.5 },
  { sku: 'MAK-CART', name: 'Cartón corrugado', category: 'Papelería y maker', kind: 'consumable', unit: 'pliego', stock: 60, min: 20, location: 'Estante I', cost: 0.8 },
  { sku: 'MAK-TAPE', name: 'Cinta de enmascarar', category: 'Papelería y maker', kind: 'consumable', unit: 'ud', stock: 25, min: 8, location: 'Estante I', cost: 1.2 },
  { sku: 'MAK-MDF', name: 'Lámina de MDF 3 mm', category: 'Papelería y maker', kind: 'consumable', unit: 'lámina', stock: 30, min: 10, location: 'Estante I', cost: 3.5 },
]

export interface SeedPrinter {
  key: string
  name: string
  model: string
  location: string
  intervalHours: number
  /** Valores "de partida" de los contadores (uso anterior al historial de la demo). */
  totalHours: number
  hoursSinceMaintenance: number
}

export const SEED_PRINTERS: SeedPrinter[] = [
  { key: 'prusa', name: 'Prusa MK4', model: 'Prusa MK4 S', location: 'Mesa 1', intervalHours: 150, totalHours: 412, hoursSinceMaintenance: 61 },
  { key: 'ender', name: 'Ender 3 V3', model: 'Creality Ender-3 V3 SE', location: 'Mesa 1', intervalHours: 100, totalHours: 655, hoursSinceMaintenance: 82 },
  { key: 'bambu', name: 'Bambu A1 mini', model: 'Bambu Lab A1 mini', location: 'Mesa 2', intervalHours: 120, totalHours: 128, hoursSinceMaintenance: 24 },
  { key: 'k1', name: 'Creality K1', model: 'Creality K1', location: 'Mesa 2', intervalHours: 100, totalHours: 301, hoursSinceMaintenance: 93 },
]
