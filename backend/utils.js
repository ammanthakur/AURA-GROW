const fs = require('fs-extra');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const READINGS_FILE = path.join(DATA_DIR, 'readings.json');

async function readJsonSafe(file){
  try{
    await fs.ensureFile(file);
    const txt = await fs.readFile(file, 'utf8');
    if(!txt) return [];
    return JSON.parse(txt || '[]');
  }catch(e){
    return [];
  }
}

async function writeJsonSafe(file, data){
  await fs.ensureFile(file);
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = {
  DATA_DIR,
  USERS_FILE,
  READINGS_FILE,
  readJsonSafe,
  writeJsonSafe
};
