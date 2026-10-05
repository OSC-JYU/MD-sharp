# md-sharp Help


## Endpoints

- GET /health: Returns service health status.
- GET /config: Returns the service descriptor from service.json.
- GET /help: Returns this help markdown.
- POST /process: Executes an image task.
  - API mode: `message` + `content` (+ `source` for extract_rois) multipart -> downloadable output.
  - Disk mode (requires `MD_PATH`): `message` only (file.path resolved on shared volume) -> output written to MessyDesk's shared tmp directory.
- GET /files/{dir}/{file}: Downloads a generated file (API mode only; deleted after download).

## Tasks

- thumbnail: Generate an 800px preview + 200px thumbnail (dual output). Invoked automatically; not user-selectable.
- resize: Resize by width, keeping aspect ratio.
- fit: Resize to fit inside a width x height box, keeping aspect ratio.
- flip: Flip image vertically.
- rotate: Rotate image by a given angle.
- blur: Gaussian blur by amount (0-100%, scaled to image size).
- convert: Convert image to another format (jpeg/png/webp).
- extract_rois: Run on a `roi.json` (regions drawn in MessyDesk) or `polygons.json` (line segmentation) file; cuts every region out of the image the file was made on, one image per region. Needs the image as `message.file.source` (uploaded as the `source` part in API mode). `mask` decides what happens outside a polygon or circle: `white` (default), `transparent` (PNG) or `none` (bounding box). `layer` picks `lines` (default) or `regions` from a `polygons.json`.

Task parameters are defined in service.json.
