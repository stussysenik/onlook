defmodule OnlookBackend.Repo do
  use Ecto.Repo,
    otp_app: :onlook_backend,
    adapter: Ecto.Adapters.SQLite3
end
