defmodule OnlookBackendWeb.CopilotControllerTest do
  use OnlookBackendWeb.ConnCase, async: false

  test "returns validated edit suggestions from NVIDIA NIM", %{conn: conn} do
    bypass = Bypass.open()
    previous_config = Application.get_env(:onlook_backend, OnlookBackend.AI, [])

    Application.put_env(:onlook_backend, OnlookBackend.AI,
      nvidia_nim_api_key: "test-key",
      nvidia_nim_base_url: "http://localhost:#{bypass.port}/v1",
      nvidia_nim_model: "moonshotai/kimi-k2-instruct-0905"
    )

    on_exit(fn ->
      Application.put_env(:onlook_backend, OnlookBackend.AI, previous_config)
    end)

    Bypass.expect_once(bypass, "POST", "/v1/chat/completions", fn conn ->
      {:ok, body, conn} = Plug.Conn.read_body(conn)
      assert body =~ "\"model\":\"moonshotai/kimi-k2-instruct-0905\""
      assert body =~ "\"thinking\":{\"type\":\"disabled\"}"

      Plug.Conn.resp(
        conn,
        200,
        Jason.encode!(%{
          choices: [
            %{
              message: %{
                content:
                  Jason.encode!(%{
                    message: "Updated the selected heading",
                    warnings: [],
                    edits: [
                      %{
                        type: "update_text",
                        nodeId: "root.0.0",
                        text: "Onlook Holy Grail"
                      }
                    ]
                  })
              }
            }
          ]
        })
      )
    end)

    create_conn =
      post(conn, ~p"/api/ai/copilot/edits", %{
        framework: "svelte",
        intent: "Rename the heading to Onlook Holy Grail",
        selected_node_id: "root.0.0",
        provider_options: %{
          provider: "nvidia_nim",
          mode: "instant"
        },
        document: %{
          framework: "svelte",
          source: "<section><h1>Onlook Next</h1></section>",
          warnings: [],
          root: %{
            id: "root",
            kind: "fragment",
            name: "#root",
            attributes: %{},
            children: [
              %{
                id: "root.0",
                kind: "element",
                name: "section",
                attributes: %{},
                children: [
                  %{
                    id: "root.0.0",
                    kind: "element",
                    name: "h1",
                    attributes: %{},
                    children: [
                      %{
                        id: "root.0.0.0",
                        kind: "text",
                        name: "#text",
                        attributes: %{},
                        children: [],
                        textContent: "Onlook Next"
                      }
                    ]
                  }
                ]
              }
            ]
          }
        }
      })

    assert %{"data" => payload} = json_response(create_conn, 200)
    assert payload["provider"] == "nvidia_nim"
    assert payload["mode"] == "instant"

    assert payload["edits"] == [
             %{
               "type" => "update_text",
               "nodeId" => "root.0.0",
               "text" => "Onlook Holy Grail"
             }
           ]
  end

  test "rejects edits that reference unknown nodes", %{conn: conn} do
    previous_config = Application.get_env(:onlook_backend, OnlookBackend.AI, [])

    Application.put_env(:onlook_backend, OnlookBackend.AI,
      nvidia_nim_api_key: "test-key",
      nvidia_nim_base_url: "http://127.0.0.1:1/v1",
      nvidia_nim_model: "moonshotai/kimi-k2-instruct-0905"
    )

    on_exit(fn ->
      Application.put_env(:onlook_backend, OnlookBackend.AI, previous_config)
    end)

    create_conn =
      post(conn, ~p"/api/ai/copilot/edits", %{
        framework: "svelte",
        intent: "Rename the missing node",
        selected_node_id: "root.99",
        document: %{
          framework: "svelte",
          source: "<div>Hello</div>",
          warnings: [],
          root: %{
            id: "root",
            kind: "fragment",
            name: "#root",
            attributes: %{},
            children: [
              %{
                id: "root.0",
                kind: "element",
                name: "div",
                attributes: %{},
                children: []
              }
            ]
          }
        }
      })

    assert %{"errors" => %{"detail" => "selected_node_id references an unknown node"}} =
             json_response(create_conn, 422)
  end

  test "returns a clear config error when the NVIDIA API key is missing", %{conn: conn} do
    previous_config = Application.get_env(:onlook_backend, OnlookBackend.AI, [])
    Application.put_env(:onlook_backend, OnlookBackend.AI, [])

    on_exit(fn ->
      Application.put_env(:onlook_backend, OnlookBackend.AI, previous_config)
    end)

    create_conn =
      post(conn, ~p"/api/ai/copilot/edits", %{
        framework: "react",
        intent: "Add a class to the section",
        selected_node_id: "root.0",
        document: %{
          framework: "react",
          source: "<section />",
          warnings: [],
          root: %{
            id: "root",
            kind: "fragment",
            name: "#root",
            attributes: %{},
            children: [
              %{
                id: "root.0",
                kind: "element",
                name: "section",
                attributes: %{},
                children: []
              }
            ]
          }
        }
      })

    assert %{"errors" => %{"detail" => "NVIDIA_NIM_API_KEY is not configured"}} =
             json_response(create_conn, 503)
  end
end
