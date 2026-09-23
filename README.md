# md-sharp

MessyDesk image processing service based on [sharp](https://sharp.pixelplumbing.com/) (libvips).

Runs as a standalone Hapi HTTP service using the same `elg` message protocol as
`MD-tesseract`: `POST /process` with `message` (JSON) + `content` (file) multipart
fields, returning `{ response: { uri: [...] } }` pointing at `GET /files/{dir}/{file}`.

It is registered with MessyDesk under the `md-sharp` service id so it is a
drop-in replacement for the previous in-process `sharp-thumbnailer` adapter in
`MD-consumers` — no changes to `MD-consumers` are required. See `service.json`
for the supported tasks and `wiki/` reference in `MD-consumers` for the wider
adapter/queue architecture.

## Storage modes

md-sharp supports two modes on the same `/process` endpoint, selected purely by
whether the request includes a `content` file part:

- **API mode** (default, adapter: `elg`): the consumer uploads `content` +
  `message`; md-sharp writes output to `./data/<uuid>/` and returns downloadable
  `GET /files/{dir}/{file}` URIs.
- **Disk mode** (adapter: `elg_fs`, requires `MD_PATH`): the consumer sends only
  `message` (with `file.path` relative to `MD_PATH`, no file upload). md-sharp
  reads the source directly off the shared MessyDesk data volume and writes
  output into the same shared scratch directory MessyDesk itself resolves
  (`<MD_PATH>/data/projects/tmp`), returning `response.files` (basename +
  label) so MD-consumers' existing `elg_fs` adapter can post a `tmp_path`
  callback to MessyDesk — the consumer never touches file bytes. Path
  traversal outside `MD_PATH` is rejected.

Set `MD_PATH` to the MessyDesk root (the directory containing `data/`) to
enable disk mode; leave it unset to run purely as an HTTP API.

## Tasks

See [help/index.md](help/index.md) or `GET /help` for the list of supported tasks
(`thumbnail`, `resize`, `fit`, `flip`, `rotate`, `blur`, `convert`).

## Development

	npm install
	npm start

## Example requests

Thumbnail (dual preview + thumbnail output):

	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "message=@test/thumbnail.json;type=application/json" \
	  -F "content=@test/sample.jpg" \
	  http://localhost:9000/process

Resize:

	curl -X POST -H "Content-Type: multipart/form-data" \
	  -F "message=@test/resize.json;type=application/json" \
	  -F "content=@test/sample.jpg" \
	  http://localhost:9000/process
