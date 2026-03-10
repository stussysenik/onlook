defmodule OnlookBackendWeb.UserSocket do
  use Phoenix.Socket

  channel "project:*", OnlookBackendWeb.ProjectChannel

  @impl true
  def connect(%{"client_id" => client_id}, socket, _connect_info) when is_binary(client_id) do
    {:ok, assign(socket, :client_id, client_id)}
  end

  def connect(_params, _socket, _connect_info), do: :error

  @impl true
  def id(socket), do: "client_socket:#{socket.assigns.client_id}"
end
