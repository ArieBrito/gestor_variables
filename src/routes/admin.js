// Rutas de administración: usuarios, sesión actual y modelos ML.
import { Router } from 'express';
import { adminRequired, apiAuth, generatePasswordHash } from '../auth.js';
import { DISABLE_AUTH, logger } from '../config.js';
import { must, supabase } from '../db.js';
import { deleteModels, rollbackModels, trainModels } from '../ml.js';
import { fail } from './util.js';

export const router = Router();
router.use('/api', apiAuth);

// ---- Usuarios (solo admin) ----
router.get('/api/users', adminRequired, async (_req, res) => {
  try {
    const { data } = await must(supabase.from('usuarios').select('id, username, rol'));
    return res.json(data || []);
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/users', adminRequired, async (req, res) => {
  try {
    const username = String(req.body?.username ?? '').trim();
    const password = String(req.body?.password ?? '').trim();
    const rol = req.body?.rol || 'user';
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const { data: ex } = await must(supabase.from('usuarios').select('id').eq('username', username));
    if (ex?.length) return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    const { data } = await must(supabase.from('usuarios').insert({ username, password_hash: await generatePasswordHash(password), rol }).select());
    if (!data?.length) return res.status(500).json({ error: 'Error al crear usuario' });
    return res.status(201).json({ id: data[0].id, username: data[0].username, rol: data[0].rol || 'user' });
  } catch (e) {
    return fail(res, e);
  }
});

router.put('/api/users/:id', adminRequired, async (req, res) => {
  try {
    const userId = req.params.id;
    const body = req.body || {};
    if (req.user && userId === req.user.id) return res.status(403).json({ error: 'No puedes modificarte a ti mismo desde aquí' });
    const { data: ex } = await must(supabase.from('usuarios').select('id, username').eq('id', userId));
    if (!ex?.length) return res.status(404).json({ error: 'Usuario no encontrado' });

    const updates = {};
    if (body.username) {
      const name = String(body.username).trim();
      if (name.length < 3) return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres' });
      if (name !== ex[0].username) {
        const { data: dup } = await must(supabase.from('usuarios').select('id').eq('username', name));
        if (dup?.length) return res.status(400).json({ error: `El nombre de usuario '${name}' ya existe` });
        updates.username = name;
      }
    }
    if (body.password) {
      const pw = String(body.password).trim();
      if (pw.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
      updates.password_hash = await generatePasswordHash(pw);
    }
    if (['admin', 'user'].includes(body.rol)) updates.rol = body.rol;
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No se proporcionaron campos para actualizar' });

    const { data } = await must(supabase.from('usuarios').update(updates).eq('id', userId).select());
    if (!data?.length) return res.status(500).json({ error: 'Error al actualizar usuario' });
    return res.json({ id: data[0].id, username: data[0].username, rol: data[0].rol || 'user' });
  } catch (e) {
    return fail(res, e);
  }
});

router.delete('/api/users/:id', adminRequired, async (req, res) => {
  try {
    if (req.user && req.params.id === req.user.id) return res.status(403).json({ error: 'No puedes eliminarte a ti mismo' });
    const { data: ex } = await must(supabase.from('usuarios').select('id').eq('id', req.params.id));
    if (!ex?.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { data } = await must(supabase.from('usuarios').delete().eq('id', req.params.id).select());
    if (!data?.length) return res.status(500).json({ error: 'Error al eliminar usuario' });
    return res.json({ message: 'Usuario eliminado correctamente' });
  } catch (e) {
    return fail(res, e);
  }
});

router.put('/api/change-own-password', async (req, res) => {
  try {
    if (DISABLE_AUTH) return res.status(400).json({ error: 'Autenticación deshabilitada' });
    const pw = String(req.body?.password ?? '').trim();
    if (pw.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const { data } = await must(supabase.from('usuarios').update({ password_hash: await generatePasswordHash(pw) }).eq('id', req.user.id).select());
    if (!data?.length) return res.status(500).json({ error: 'No se pudo actualizar la contraseña' });
    logger.info(`🔑 Usuario ${req.user.username} cambió su propia contraseña`);
    return res.json({ status: 'ok' });
  } catch (e) {
    return fail(res, e);
  }
});

router.get('/api/current-user', (req, res) => {
  if (DISABLE_AUTH) return res.json({ id: 'disabled', username: 'disabled', rol: 'admin' });
  if (req.user) return res.json({ id: req.user.id, username: req.user.username, rol: req.user.rol });
  return res.status(401).json({ error: 'No autenticado' });
});

// ---- Modelos ML ----
router.post('/api/retrain-models', async (_req, res) => {
  try {
    const r = await trainModels();
    if (r.status === 'success') return res.json({ status: 'ok', message: r.message, report: r.report });
    return res.status(500).json({ error: r.message || 'Error al entrenar' });
  } catch (e) {
    return fail(res, e);
  }
});

router.post('/api/rollback-models', (_req, res) => {
  try {
    const restored = rollbackModels();
    if (restored.length) return res.json({ status: 'ok', message: `Restaurados: ${restored.join(', ')}` });
    return res.status(404).json({ error: 'No hay backups disponibles' });
  } catch (e) {
    return fail(res, e);
  }
});

router.delete('/api/delete-models', (_req, res) => {
  try {
    return res.json({ status: 'ok', message: `Eliminados: ${deleteModels().join(', ')}` });
  } catch (e) {
    return fail(res, e);
  }
});
