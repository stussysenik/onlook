defmodule OnlookBackend.AI do
  @moduledoc false

  alias OnlookBackend.AI.EditValidator
  alias OnlookBackend.AI.Providers.NvidiaNimProvider

  @supported_frameworks ["react", "svelte"]
  @supported_modes ["instant", "thinking"]

  def request_edits(params) do
    with {:ok, request} <- normalize_request(params),
         {:ok, config} <- load_provider_config(),
         model = request.model || config.default_model,
         {:ok, content} <-
           NvidiaNimProvider.request_completion(config, %{
             messages: build_messages(request),
             model: model,
             mode: request.mode
           }),
         {:ok, payload} <- decode_model_payload(content),
         {:ok, validated_payload} <-
           map_invalid_response(EditValidator.validate_model_payload(payload, request.node_ids)) do
      {:ok,
       %{
         provider: request.provider,
         model: model,
         mode: request.mode,
         message: validated_payload["message"],
         edits: validated_payload["edits"],
         warnings: validated_payload["warnings"]
       }}
    end
  end

  defp normalize_request(
         %{"framework" => framework, "intent" => intent, "document" => document} = params
       )
       when is_binary(intent) do
    provider_options = Map.get(params, "provider_options", %{})

    with :ok <- validate_framework(framework),
         :ok <- validate_document_framework(document, framework),
         {:ok, node_ids} <- map_invalid_request(EditValidator.collect_node_ids(document)),
         :ok <-
           map_invalid_request(
             EditValidator.validate_selected_node_id(
               Map.get(params, "selected_node_id"),
               node_ids
             )
           ),
         {:ok, provider} <-
           normalize_provider(Map.get(provider_options, "provider", "nvidia_nim")),
         {:ok, mode} <- normalize_mode(Map.get(provider_options, "mode", "instant")) do
      {:ok,
       %{
         framework: framework,
         intent: String.trim(intent),
         selected_node_id: Map.get(params, "selected_node_id"),
         provider: provider,
         model: normalize_model(Map.get(provider_options, "model")),
         mode: mode,
         document: document,
         node_ids: node_ids
       }}
    end
  end

  defp normalize_request(_params) do
    {:error, {:invalid_request, "framework, intent, and document are required"}}
  end

  defp validate_framework(framework) when framework in @supported_frameworks, do: :ok

  defp validate_framework(_framework),
    do: {:error, {:invalid_request, "framework must be react or svelte"}}

  defp validate_document_framework(%{"framework" => framework}, framework), do: :ok

  defp validate_document_framework(_document, _framework) do
    {:error, {:invalid_request, "document.framework must match framework"}}
  end

  defp normalize_provider("nvidia_nim"), do: {:ok, "nvidia_nim"}

  defp normalize_provider(_provider),
    do: {:error, {:invalid_request, "provider must be nvidia_nim"}}

  defp normalize_mode(mode) when mode in @supported_modes, do: {:ok, mode}
  defp normalize_mode(_mode), do: {:error, {:invalid_request, "mode must be instant or thinking"}}

  defp normalize_model(model) when is_binary(model) and byte_size(model) > 0, do: model
  defp normalize_model(_model), do: nil

  defp load_provider_config do
    config = Application.get_env(:onlook_backend, __MODULE__, [])
    api_key = Keyword.get(config, :nvidia_nim_api_key)

    if is_binary(api_key) and String.trim(api_key) != "" do
      {:ok,
       %{
         api_key: api_key,
         base_url:
           Keyword.get(config, :nvidia_nim_base_url, "https://integrate.api.nvidia.com/v1"),
         default_model: Keyword.get(config, :nvidia_nim_model, "moonshotai/kimi-k2-instruct-0905")
       }}
    else
      {:error, {:config, "NVIDIA_NIM_API_KEY is not configured"}}
    end
  end

  defp build_messages(request) do
    [
      %{
        role: "system",
        content:
          "You are an editing copilot for a source-aware visual editor. " <>
            "Return JSON only with keys message, warnings, and edits. " <>
            "Each edit must match one of the supported editor actions exactly. " <>
            "Never invent node ids."
      },
      %{
        role: "user",
        content:
          Jason.encode!(%{
            task:
              "Generate the smallest valid set of edit actions that fulfills the user intent.",
            framework: request.framework,
            mode: request.mode,
            intent: request.intent,
            selected_node_id: request.selected_node_id,
            supported_actions: [
              %{"type" => "update_text", "shape" => %{"nodeId" => "string", "text" => "string"}},
              %{
                "type" => "update_attributes",
                "shape" => %{
                  "nodeId" => "string",
                  "attributes" => %{"attributeName" => "string|null"}
                }
              },
              %{
                "type" => "update_styles",
                "shape" => %{"nodeId" => "string", "className" => "string"}
              },
              %{
                "type" => "insert_node",
                "shape" => %{
                  "parentId" => "string",
                  "index" => "integer?",
                  "node" => %{
                    "kind" => "element|component|text",
                    "name" => "string",
                    "attributes" => %{},
                    "textContent" => "string?",
                    "children" => []
                  }
                }
              },
              %{
                "type" => "move_node",
                "shape" => %{
                  "nodeId" => "string",
                  "targetParentId" => "string",
                  "index" => "integer"
                }
              },
              %{"type" => "remove_node", "shape" => %{"nodeId" => "string"}}
            ],
            document: build_document_context(request.document, request.selected_node_id)
          })
      }
    ]
  end

  defp build_document_context(document, selected_node_id) do
    %{
      source: Map.get(document, "source"),
      warnings: Map.get(document, "warnings", []),
      selected_node: find_node(Map.get(document, "root"), selected_node_id),
      node_outline: summarize_node(Map.get(document, "root"), 0)
    }
  end

  defp summarize_node(nil, _depth), do: nil

  defp summarize_node(node, depth) when depth > 4 do
    %{
      id: node["id"],
      name: node["name"],
      kind: node["kind"],
      children: ["truncated"]
    }
  end

  defp summarize_node(node, depth) do
    %{
      id: node["id"],
      name: node["name"],
      kind: node["kind"],
      attributes: Map.get(node, "attributes", %{}),
      text: truncate_text(Map.get(node, "textContent")),
      children:
        Enum.map(Map.get(node, "children", []), fn child ->
          summarize_node(child, depth + 1)
        end)
    }
  end

  defp find_node(_node, nil), do: nil

  defp find_node(%{"id" => id} = node, id), do: summarize_node(node, 0)

  defp find_node(%{"children" => children}, node_id) do
    Enum.find_value(children, fn child -> find_node(child, node_id) end)
  end

  defp find_node(_node, _node_id), do: nil

  defp truncate_text(nil), do: nil
  defp truncate_text(text) when byte_size(text) <= 120, do: text
  defp truncate_text(text), do: String.slice(text, 0, 117) <> "..."

  defp decode_model_payload(content) do
    content
    |> extract_json_payload()
    |> Jason.decode()
    |> case do
      {:ok, payload} -> {:ok, payload}
      {:error, _reason} -> {:error, {:invalid_response, "model returned invalid JSON"}}
    end
  end

  defp extract_json_payload(content) do
    fenced =
      Regex.run(~r/```json\s*(\{.*\})\s*```/s, content, capture: :all_but_first)

    case fenced do
      [payload] ->
        payload

      _ ->
        start_index =
          case :binary.match(content, "{") do
            {index, _length} -> index
            :nomatch -> nil
          end

        end_index =
          content
          |> :binary.matches("}")
          |> List.last()
          |> case do
            {index, _length} -> index
            nil -> nil
          end

        if is_integer(start_index) and is_integer(end_index) and end_index > start_index do
          binary_part(content, start_index, end_index - start_index + 1)
        else
          content
        end
    end
  end

  defp map_invalid_request(:ok), do: :ok
  defp map_invalid_request({:ok, value}), do: {:ok, value}
  defp map_invalid_request({:error, reason}), do: {:error, {:invalid_request, reason}}

  defp map_invalid_response({:ok, value}), do: {:ok, value}
  defp map_invalid_response({:error, reason}), do: {:error, {:invalid_response, reason}}
end
