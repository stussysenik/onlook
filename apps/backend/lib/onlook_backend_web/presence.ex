defmodule OnlookBackendWeb.Presence do
  use Phoenix.Presence,
    otp_app: :onlook_backend,
    pubsub_server: OnlookBackend.PubSub
end
