"""Server-side image bridge; never uses a desktop image worker."""
import json
import sys
import os
from pathlib import Path

payload = json.load(sys.stdin)
if payload['action'] in ('image', 'image-check'):
    # Credentials remain server-side. No source .env is modified or copied to the frontend.
    from concept_images import ImageJobs, load_config, build_prompt
    config = load_config()
    env_path = os.environ.get('ZHOUZHI_IMAGE_ENV', '')
    if env_path and Path(env_path).is_file():
        for line in Path(env_path).read_text().splitlines():
            key, sep, value = line.partition('=')
            if sep and key.strip() in config:
                config[key.strip()] = value.strip().strip('"').strip("'")
    if payload['action'] == 'image-check':
        from urllib.request import Request, urlopen
        request = Request(config['IMAGE_API_BASE_URL'].rstrip('/')+'/models', headers={'Authorization':'Bearer '+config['IMAGE_API_KEY']})
        try:
            with urlopen(request, timeout=45) as response:
                body = json.loads(response.read(2*1024*1024))
            if config['IMAGE_MODEL'] not in [m.get('id') for m in body.get('data', [])]:
                raise ValueError('生图模型不可用')
            print(json.dumps({'connected':True, 'mode':'server-direct', 'model':config['IMAGE_MODEL']}))
            sys.exit(0)
        except Exception as error:
            raise ValueError('生图连接检查失败：'+type(error).__name__) from None
    jobs = ImageJobs(root=Path(payload['target']).parent, config=config)
    if not jobs.configured:
        raise ValueError('没有配置生图服务密钥')
    reference = payload.get('reference')
    try:
        raw, url = jobs._request_image(build_prompt(payload['description']), reference=reference)
    except Exception as error:
        raise ValueError(str(error).replace(config['IMAGE_API_KEY'], '[已隐藏]')) from None
    target = Path(payload['target'])
    width, height = jobs._save_image(raw, target)
    print(json.dumps({'width':width, 'height':height}, ensure_ascii=False))
else:
    raise ValueError('不支持的图片操作')
