defmodule OnlookBackendWeb.SessionControllerTest do
  use OnlookBackendWeb.ConnCase, async: false

  alias OnlookBackend.Studio

  test "creates and lists sessions", %{conn: conn} do
    {:ok, project} =
      Studio.create_project(%{
        name: "Session Draft",
        framework: "react",
        source: "<div />"
      })

    create_conn =
      post(conn, ~p"/api/sessions", %{
        session: %{
          client_id: "editor-ui",
          project_id: project.id
        }
      })

    assert %{"data" => created_session} = json_response(create_conn, 201)
    assert created_session["project_id"] == project.id

    list_conn = get(recycle(conn), ~p"/api/projects/#{project.id}/sessions")
    assert %{"data" => sessions} = json_response(list_conn, 200)
    assert Enum.any?(sessions, fn session -> session["id"] == created_session["id"] end)
  end
end
