defmodule OnlookBackend.AI.Providers.NvidiaNimProvider do
  @moduledoc false

  def request_completion(config, %{messages: messages, model: model, mode: mode}) do
    request_body =
      %{
        model: model,
        temperature: temperature_for_mode(mode),
        messages: messages
      }
      |> maybe_put_instant_mode(mode)

    case Req.post("#{config.base_url}/chat/completions",
           finch: OnlookBackend.Finch,
           receive_timeout: 30_000,
           auth: {:bearer, config.api_key},
           json: request_body
         ) do
      {:ok, %Req.Response{status: status, body: body}} when status in 200..299 ->
        with {:ok, payload} <- decode_body(body) do
          case get_in(payload, ["choices", Access.at(0), "message", "content"]) do
            content when is_binary(content) and byte_size(content) > 0 -> {:ok, content}
            _ -> {:error, {:upstream, "NVIDIA NIM returned an empty completion payload"}}
          end
        end

      {:ok, %Req.Response{status: status, body: body}} ->
        detail =
          case decode_body(body) do
            {:ok, payload} -> extract_error_detail(payload)
            {:error, _reason} -> "upstream error"
          end

        {:error, {:provider, "NVIDIA NIM request failed with status #{status}: #{detail}"}}

      {:error, error} ->
        {:error, {:provider, Exception.message(error)}}
    end
  end

  defp decode_body(body) when is_map(body), do: {:ok, body}

  defp decode_body(body) when is_binary(body) do
    case Jason.decode(body) do
      {:ok, payload} -> {:ok, payload}
      {:error, _reason} -> {:error, :invalid_json}
    end
  end

  defp decode_body(_body), do: {:error, :invalid_json}

  defp maybe_put_instant_mode(request_body, "instant") do
    Map.put(request_body, :thinking, %{
      type: "disabled"
    })
  end

  defp maybe_put_instant_mode(request_body, _mode), do: request_body

  defp temperature_for_mode("thinking"), do: 0.3
  defp temperature_for_mode(_mode), do: 0.2

  defp extract_error_detail(%{"error" => %{"message" => message}}) when is_binary(message),
    do: message

  defp extract_error_detail(%{"error" => message}) when is_binary(message), do: message
  defp extract_error_detail(_body), do: "upstream error"
end
