job "md-sharp" {
  type = "service"

  group "MD-sharp" {
    count = 1

    restart {
      attempts = 2
      interval = "5m"
      delay    = "15s"
      mode     = "fail"
    }

    reschedule {
      attempts       = 2
      interval       = "10m"
      delay          = "30s"
      delay_function = "constant"
      unlimited      = false
    }

    network {
      port "node" {
        to = 9000
      }
    }

    # job/service name is rewritten to TOPIC by MD-consumers' createService() at submit time,
    # so each TOPIC gets its own Nomad job + allocation (see MD-consumers funcs.mjs).
    service {
      name     = "md-sharp"
      port     = "node"
      provider = "nomad"

      check {
        type     = "http"
        path     = "/health"
        interval = "10s"
        timeout  = "3s"
      }
    }

    task "md-sharp" {
      driver = "podman"
      config {
          image = "localhost/messydesk/md-sharp:0.1"
          force_pull = false
          ports = ["node"]
      }
      env {
        # Bind to Nomad's per-allocation assigned port, not a literal 9000: this driver runs
        # in host network mode, so the container binds host ports directly (no NAT via `to`).
        PORT = "${NOMAD_PORT_node}"
        # Overrides service.json's static local_url so /config reports the real, reachable address.
        # NOMAD_PORT_node is the container-internal port (matches `to`); use the host-mapped port instead.
        SERVICE_LOCAL_URL = "http://${NOMAD_IP_node}:${NOMAD_HOST_PORT_node}"
      }
      resources {
        memory = 2048  # Memory in MB: headroom for large TIFF/scan inputs (limitInputPixels is disabled)
        cpu    = 300  # CPU shares (300 = 30% of 1 CPU)
      }
    }
  }
}
