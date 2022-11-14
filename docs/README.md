# gitdiff-docker-push

Automatically push docker image

1. Find `dockermeta.yaml` and `Dockerfile` diff
2. Build image according to `dockermeta.yaml` with tag [HeadVer](https://github.com/line/headver)
3. Push to registries in `dockermeta.yaml`
4. Create git tag

c.f. `dockermeta.yaml`(configFile) name is configurable

## dockermeta.yaml

Example:

```
head: 1
registries:
 - public.ecr.aws
 - gcr.io
repository: test
```
