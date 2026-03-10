defmodule OnlookBackend.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    children = [
      OnlookBackendWeb.Telemetry,
      OnlookBackend.Repo,
      {Ecto.Migrator,
       repos: Application.fetch_env!(:onlook_backend, :ecto_repos), skip: skip_migrations?()},
      {DNSCluster, query: Application.get_env(:onlook_backend, :dns_cluster_query) || :ignore},
      {Finch, name: OnlookBackend.Finch},
      {Phoenix.PubSub, name: OnlookBackend.PubSub},
      OnlookBackendWeb.Presence,
      # Start a worker by calling: OnlookBackend.Worker.start_link(arg)
      # {OnlookBackend.Worker, arg},
      # Start to serve requests, typically the last entry
      OnlookBackendWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: OnlookBackend.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    OnlookBackendWeb.Endpoint.config_change(changed, removed)
    :ok
  end

  defp skip_migrations?() do
    # By default, sqlite migrations are run when using a release
    System.get_env("RELEASE_NAME") == nil
  end
end
