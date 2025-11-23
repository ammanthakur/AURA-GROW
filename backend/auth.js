const jwt = require('jsonwebtoken');
const { USERS_FILE, readJsonSafe } = require('./utils');
const fs = require('fs-extra');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'secret-dev';

function generateToken(payload){
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

function verifyTokenMiddleware(req, res, next){
  const h = req.headers['authorization'] || req.headers['Authorization'];
  if(!h) return res.status(401).json({ error: 'Missing Authorization header' });
  const parts = String(h).split(' ');
  if(parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return res.status(401).json({ error: 'Invalid Authorization format' });
  const token = parts[1];
  try{
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    return next();
  }catch(e){
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { generateToken, verifyTokenMiddleware };
