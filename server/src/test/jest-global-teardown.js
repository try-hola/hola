const fs = require('fs-extra');
const path = require('path');
const glob = require('glob');

module.exports = async () => {
  // Find and clean up any leftover test directories in /tmp
  try {
    const testDirs = glob.sync('/tmp/data_test_*');
    
    for (const dir of testDirs) {
      console.log(`Cleaning up leftover test directory: ${dir}`);
      try {
        fs.removeSync(dir);
      } catch (err) {
        console.warn(`Failed to remove ${dir}:`, err);
      }
    }

    // Also check for any lingering data directories in project root
    const projectTestDirs = glob.sync(path.join(process.cwd(), 'data_test_*'));
    for (const dir of projectTestDirs) {
      console.log(`Cleaning up project test directory: ${dir}`);
      try {
        fs.removeSync(dir);
      } catch (err) {
        console.warn(`Failed to remove ${dir}:`, err);
      }
    }
  } catch (err) {
    console.warn('Error during global test cleanup:', err);
  }
};