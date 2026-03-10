defmodule OnlookBackendWeb.ProjectChannelTest do
  use OnlookBackendWeb.ChannelCase, async: false

  alias OnlookBackend.Studio
  alias OnlookBackendWeb.ProjectChannel
  alias OnlookBackendWeb.UserSocket

  test "joins the project channel and broadcasts edit events" do
    {:ok, project} =
      Studio.create_project(%{
        name: "Realtime Draft",
        framework: "svelte",
        source: "<div>Hello</div>"
      })

    {:ok, _, socket} =
      socket(UserSocket, "client_socket:editor-ui", %{client_id: "editor-ui"})
      |> subscribe_and_join(ProjectChannel, "project:#{project.id}", %{"client_id" => "editor-ui"})

    assert_push "presence_state", _

    ref =
      push(socket, "edit_applied", %{
        "type" => "update_text",
        "node_id" => "root.0.0"
      })

    assert_reply ref, :ok

    assert_broadcast "edit_applied", broadcast

    assert broadcast == %{
             "type" => "update_text",
             "node_id" => "root.0.0",
             "client_id" => "editor-ui",
             "project_id" => project.id
           }
  end
end
