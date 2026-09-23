IMAGES := $(shell docker images -f "dangling=true" -q)
CONTAINERS := $(shell docker ps -a -q -f status=exited)
VOLUME := md-sharp-data
VERSION := 0.1
REPOSITORY := localhost
IMAGE := md-sharp


clean:
	docker rm -f $(CONTAINERS)
	docker rmi -f $(IMAGES)

build:
	docker build -t $(REPOSITORY)/messydesk/$(IMAGE):$(VERSION) .

start:
	docker run -d --name $(IMAGE) \
		-v $(VOLUME):/logs \
		-p 9000:9000 \
		--restart unless-stopped \
		$(REPOSITORY)/messydesk/$(IMAGE):$(VERSION)

restart:
	docker stop $(IMAGE)
	docker rm $(IMAGE)
	$(MAKE) start

stop:
	docker stop $(IMAGE)
	docker rm $(IMAGE)

bash:
	docker exec -it $(IMAGE) bash
