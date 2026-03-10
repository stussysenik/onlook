defmodule OnlookBackendWeb.ProjectChannel do
  use OnlookBackendWeb, :channel

  alias OnlookBackend.Studio
  alias OnlookBackendWeb.Presence

  @impl true
  def join("project:" <> project_id, %{"client_id" => client_id}, socket) do
    case Studio.get_project(project_id) do
      nil ->
        {:error, %{reason: "project_not_found"}}

      _project ->
        socket =
          socket
          |> assign(:project_id, project_id)
          |> assign(:client_id, client_id)

        send(self(), :after_join)
        {:ok, %{project_id: project_id}, socket}
    end
  end

  @impl true
  def handle_info(:after_join, socket) do
    {:ok, _meta} =
      Presence.track(socket, socket.assigns.client_id, %{
        joined_at: DateTime.utc_now() |> DateTime.to_iso8601()
      })

    push(socket, "presence_state", Presence.list(socket))
    {:noreply, socket}
  end

  @impl true
  def handle_in("edit_applied", payload, socket) do
    event =
      Map.merge(payload, %{
        "client_id" => socket.assigns.client_id,
        "project_id" => socket.assigns.project_id
      })

    broadcast_from!(socket, "edit_applied", event)
    {:reply, :ok, socket}
  end

  @impl true
  def handle_in("cursor_moved", payload, socket) do
    event =
      Map.merge(payload, %{
        "client_id" => socket.assigns.client_id
      })

    broadcast_from!(socket, "cursor_moved", event)
    {:reply, :ok, socket}
  end
end
