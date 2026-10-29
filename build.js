import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

async function build() {
  console.log('🚀 开始构建课堂便签插件 (@openlearn-ext/whiteboard-sticky-notes)...');

  const cwd = process.cwd();
  const distDir = path.resolve(cwd, 'dist');
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  // 1. 构建后端服务入口 (src/index.ts -> dist/index.js)
  console.log('📦 构建服务端模块 (src/index.ts -> dist/index.js)...');
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    sourcemap: 'inline',
    external: ['@openlearn/*'],
  });

  // 2. 构建沙箱前端入口 (src/frontend.tsx -> dist/frontend.js)
  console.log('🎨 构建前端沙箱桥接模块 (src/frontend.tsx -> dist/frontend.js)...');
  await esbuild.build({
    entryPoints: ['src/frontend.tsx'],
    bundle: true,
    outfile: 'dist/frontend.js',
    format: 'esm',
    platform: 'browser',
    target: 'es2020',
    sourcemap: 'inline',
  });

  // 3. 处理清单 manifest.json
  console.log('📋 校验并复制 manifest.json...');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(cwd, 'manifest.json'), 'utf-8'));
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 4. 复制 storage 静态可视沙箱视图页面
  console.log('🖼️ 复制可视沙箱视图页面 (storage/ & views/)...');
  const distStorage = path.join(distDir, 'storage');
  fs.mkdirSync(distStorage, { recursive: true });
  fs.copyFileSync(path.resolve(cwd, 'storage/student.html'), path.join(distStorage, 'student.html'));
  fs.copyFileSync(path.resolve(cwd, 'storage/teacher.html'), path.join(distStorage, 'teacher.html'));

  const distViews = path.join(distDir, 'views');
  fs.mkdirSync(distViews, { recursive: true });
  fs.copyFileSync(path.resolve(cwd, 'storage/student.html'), path.join(distViews, 'student.html'));
  fs.copyFileSync(path.resolve(cwd, 'storage/teacher.html'), path.join(distViews, 'teacher.html'));

  // 5. 打包为 ZIP 文件
  console.log('🗜️ 生成插件分发包 (openlearn-plugin-whiteboard-sticky-notes.zip)...');
  const zip = new JSZip();
  zip.file('index.js', fs.readFileSync(path.join(distDir, 'index.js')));
  zip.file('frontend.js', fs.readFileSync(path.join(distDir, 'frontend.js')));
  zip.file('manifest.json', fs.readFileSync(path.join(distDir, 'manifest.json')));
  zip.file('storage/student.html', fs.readFileSync(path.join(distStorage, 'student.html')));
  zip.file('storage/teacher.html', fs.readFileSync(path.join(distStorage, 'teacher.html')));
  zip.file('views/student.html', fs.readFileSync(path.join(distViews, 'student.html')));
  zip.file('views/teacher.html', fs.readFileSync(path.join(distViews, 'teacher.html')));

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const zipOutDist = path.join(distDir, 'openlearn-plugin-whiteboard-sticky-notes.zip');
  const zipOutRoot = path.join(cwd, 'openlearn-plugin-whiteboard-sticky-notes.zip');
  fs.writeFileSync(zipOutDist, zipBuffer);
  fs.writeFileSync(zipOutRoot, zipBuffer);

  const stat = fs.statSync(zipOutRoot);
  console.log(`✅ 构建完成！`);
  console.log(`  - 服务端产物: dist/index.js`);
  console.log(`  - 沙箱桥接: dist/frontend.js`);
  console.log(`  - 可视沙箱视图: storage/student.html (学生端), storage/teacher.html (教师端)`);
  console.log(`  - 插件包: openlearn-plugin-whiteboard-sticky-notes.zip (${(stat.size / 1024).toFixed(1)} KB)`);
}

build().catch((err) => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
