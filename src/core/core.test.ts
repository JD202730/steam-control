import { beforeEach, describe, expect, it } from 'vitest'
import { authenticate } from '@/core/auth/authService'
import { hashPassword, verifyPassword } from '@/core/auth/password'
import { clock } from '@/core/clock/clock'
import { bus } from '@/core/events/bus'
import { assertCan, can } from '@/core/permissions/roles'
import { createRng } from '@/core/random'
import { createUser, updateUser } from '@/modules/users/service'
import { admin, alice, resetDb } from '@/test/helpers'

describe('permisos y roles', () => {
  it('el usuario solo recibe permisos de consulta, solicitud y reserva', () => {
    expect(can(alice, 'requests:create')).toBe(true)
    expect(can(alice, 'inventory:read')).toBe(true)
    expect(can(alice, 'inventory:write')).toBe(false)
    expect(can(alice, 'requests:manage')).toBe(false)
    expect(can(alice, 'simulation:control')).toBe(false)
    expect(can(alice, 'users:manage')).toBe(false)
  })

  it('el administrador tiene todos los permisos', () => {
    for (const p of ['inventory:write', 'requests:manage', 'maintenance:manage', 'users:manage', 'simulation:control'] as const) {
      expect(can(admin, p)).toBe(true)
    }
  })

  it('sin sesión no se puede nada y assertCan lanza FORBIDDEN', () => {
    expect(can(null, 'inventory:read')).toBe(false)
    expect(() => assertCan(null, 'inventory:read')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
    expect(() => assertCan(alice, 'users:manage')).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }))
  })
})

describe('contraseñas', () => {
  it('guarda un hash, nunca la contraseña, y lo verifica', async () => {
    const hash = await hashPassword('Clave-Segura-1')
    expect(hash.startsWith('pbkdf2$')).toBe(true)
    expect(hash).not.toContain('Clave-Segura-1')
    expect(await verifyPassword('Clave-Segura-1', hash)).toBe(true)
    expect(await verifyPassword('otra-clave', hash)).toBe(false)
  })

  it('dos hashes de la misma contraseña son distintos (sal aleatoria)', async () => {
    expect(await hashPassword('igual')).not.toBe(await hashPassword('igual'))
  })
})

describe('usuarios y autenticación', () => {
  beforeEach(() => resetDb())

  it('crea un usuario, inicia sesión y rechaza credenciales malas o cuentas desactivadas', async () => {
    const user = await createUser(admin, {
      name: 'Nuevo Usuario',
      email: 'Nuevo@Steam.Demo',
      password: 'Clave-Segura-1',
      role: 'user',
    })
    expect(user.email).toBe('nuevo@steam.demo')
    expect(user).not.toHaveProperty('passwordHash')

    await expect(authenticate('nuevo@steam.demo', 'Clave-Segura-1')).resolves.toMatchObject({ id: user.id, role: 'user' })
    await expect(authenticate('nuevo@steam.demo', 'incorrecta')).rejects.toMatchObject({ code: 'AUTH' })
    await expect(authenticate('nadie@steam.demo', 'Clave-Segura-1')).rejects.toMatchObject({ code: 'AUTH' })

    await updateUser(admin, user.id, { status: 'disabled' })
    await expect(authenticate('nuevo@steam.demo', 'Clave-Segura-1')).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('un usuario común no puede crear usuarios', async () => {
    await expect(
      createUser(alice, { name: 'X Y', email: 'x@y.co', password: 'Clave-Segura-1', role: 'admin' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('valida correo y contraseña, y no duplica correos', async () => {
    const base = { name: 'Persona', role: 'user' as const }
    await expect(createUser(admin, { ...base, email: 'no-es-correo', password: 'Clave-Segura-1' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await expect(createUser(admin, { ...base, email: 'ok@steam.demo', password: 'corta' })).rejects.toMatchObject({ code: 'VALIDATION' })
    await createUser(admin, { ...base, email: 'dup@steam.demo', password: 'Clave-Segura-1' })
    await expect(createUser(admin, { ...base, email: 'DUP@steam.demo', password: 'Clave-Segura-1' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('no se puede quitar al último administrador activo', async () => {
    await expect(updateUser(admin, admin.id, { role: 'user' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(updateUser(admin, admin.id, { status: 'disabled' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })
})

describe('reloj y utilidades', () => {
  it('se puede congelar y acelerar sin saltos', () => {
    clock.freeze('2026-01-01T10:00:00Z')
    expect(clock.iso()).toBe('2026-01-01T10:00:00.000Z')
    clock.resetToRealTime()
    expect(clock.isFrozen()).toBe(false)
    const before = clock.nowMs()
    clock.setSpeed(60)
    expect(Math.abs(clock.nowMs() - before)).toBeLessThan(1000)
    clock.resetToRealTime()
  })

  it('el generador pseudoaleatorio es reproducible con la misma semilla', () => {
    const a = createRng(42)
    const b = createRng(42)
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()))
    const c = createRng(43)
    expect(c.next()).not.toBe(createRng(42).next())
  })

  it('el bus de eventos aísla errores de los manejadores', async () => {
    bus.clear()
    let reached = false
    bus.on('stock.out', () => {
      throw new Error('falla a propósito')
    })
    bus.on('stock.out', () => {
      reached = true
    })
    await bus.emit({ type: 'stock.out', itemId: 'i', name: 'X' })
    expect(reached).toBe(true)
  })
})
