defmodule OnlookBackendWeb.ProjectControllerTest do
  use OnlookBackendWeb.ConnCase, async: false

  test "creates and updates a project", %{conn: conn} do
    create_conn =
      post(conn, ~p"/api/projects", %{
        project: %{
          name: "Initial Draft",
          framework: "svelte",
          source: "<div>Hello</div>"
        }
      })

    assert %{"data" => created_project} = json_response(create_conn, 201)
    assert created_project["framework"] == "svelte"

    show_conn = get(recycle(conn), ~p"/api/projects/#{created_project["id"]}")
    assert %{"data" => shown_project} = json_response(show_conn, 200)
    assert shown_project["name"] == "Initial Draft"

    update_conn =
      put(recycle(conn), ~p"/api/projects/#{created_project["id"]}", %{
        project: %{
          name: "Updated Draft",
          framework: "svelte",
          source: "<section>Updated</section>"
        }
      })

    assert %{"data" => updated_project} = json_response(update_conn, 200)
    assert updated_project["name"] == "Updated Draft"
    assert updated_project["source"] == "<section>Updated</section>"
  end
end
