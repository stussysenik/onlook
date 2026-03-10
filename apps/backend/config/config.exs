# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :onlook_backend,
  ecto_repos: [OnlookBackend.Repo],
  generators: [timestamp_type: :utc_datetime, binary_id: true]

# Configure the endpoint
config :onlook_backend, OnlookBackendWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  check_origin: ["http://localhost:5173"],
  render_errors: [
    formats: [json: OnlookBackendWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: OnlookBackend.PubSub,
  live_view: [signing_salt: "jhIKxcgy"]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
